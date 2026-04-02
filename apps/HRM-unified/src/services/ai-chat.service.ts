// src/services/ai-chat.service.ts
// AI Chat Service

import { db } from "@/lib/db";
import {
  chat,
  buildHRAssistantPrompt,
  buildUserContext,
  getRelevantKnowledge,
  classifyIntent,
  processAIResponse,
} from "@/lib/ai";
import type { AIMessage, AIConversation, AIAction } from "@/types/ai";
import type { AIIntentType } from ".prisma/hrm-unified-client";

export interface SendMessageInput {
  conversationId?: string;
  message: string;
}

export interface ChatResponse {
  conversationId: string;
  message: AIMessage;
  intent: AIIntentType;
}

export const aiChatService = {
  /**
   * Send a message and get AI response
   */
  async sendMessage(
    tenantId: string,
    userId: string,
    input: SendMessageInput,
  ): Promise<ChatResponse> {
    const { conversationId, message } = input;

    // Classify intent
    const intent = await classifyIntent(message);

    // Build user context
    const userContext = await buildUserContext(userId, tenantId);

    // Get relevant knowledge for FAQ queries
    let knowledgeContext = "";
    if (intent === "FAQ") {
      knowledgeContext = await getRelevantKnowledge(tenantId, message);
    }

    // Build system prompt
    const systemPrompt = buildHRAssistantPrompt(userContext, knowledgeContext);

    // Get or create conversation
    let conversation = conversationId
      ? await db.aIConversation.findFirst({
          where: { id: conversationId, tenantId, userId },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        })
      : null;

    if (!conversation) {
      // Create new conversation
      conversation = await db.aIConversation.create({
        data: {
          tenantId,
          userId,
          title: message.slice(0, 50),
        },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
    }

    // Build message history
    const history = conversation.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Add user message
    history.push({ role: "user", content: message });

    // Get AI response
    const aiResponse = await chat(history, { systemPrompt });

    // Process response for actions
    const { message: cleanMessage, action } = processAIResponse(aiResponse);

    // Save messages to database
    await db.aIMessage.createMany({
      data: [
        {
          conversationId: conversation.id,
          role: "user",
          content: message,
          intent,
        },
        {
          conversationId: conversation.id,
          role: "assistant",
          content: cleanMessage,
          intent,
          actionType: action?.type,
          actionData: action?.data
            ? JSON.parse(JSON.stringify(action.data))
            : undefined,
        },
      ],
    });

    // Update conversation title if it's the first message
    if (conversation.messages.length === 0) {
      await db.aIConversation.update({
        where: { id: conversation.id },
        data: { title: message.slice(0, 50) },
      });
    }

    return {
      conversationId: conversation.id,
      message: {
        role: "assistant",
        content: cleanMessage,
        intent,
        action: action || undefined,
        createdAt: new Date(),
      },
      intent,
    };
  },

  /**
   * Get conversation history
   */
  async getConversation(
    tenantId: string,
    userId: string,
    conversationId: string,
  ): Promise<AIConversation | null> {
    const conversation = await db.aIConversation.findFirst({
      where: { id: conversationId, tenantId, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!conversation) return null;

    return {
      id: conversation.id,
      title: conversation.title || undefined,
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        intent: m.intent || undefined,
        action: m.actionType
          ? {
              type: m.actionType as AIAction["type"],
              data: (m.actionData as Record<string, unknown>) || {},
            }
          : undefined,
        createdAt: m.createdAt,
      })),
      createdAt: conversation.createdAt,
    };
  },

  /**
   * Get user's conversations list
   */
  async getUserConversations(
    tenantId: string,
    userId: string,
    limit: number = 20,
  ): Promise<{ id: string; title: string; createdAt: Date }[]> {
    const conversations = await db.aIConversation.findMany({
      where: { tenantId, userId },
      select: { id: true, title: true, createdAt: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return conversations.map((c) => ({
      id: c.id,
      title: c.title || "Cuộc hội thoại mới",
      createdAt: c.createdAt,
    }));
  },

  /**
   * Delete a conversation
   */
  async deleteConversation(
    tenantId: string,
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await db.aIConversation.deleteMany({
      where: { id: conversationId, tenantId, userId },
    });
  },

  /**
   * Clear all conversations for a user
   */
  async clearAllConversations(tenantId: string, userId: string): Promise<void> {
    await db.aIConversation.deleteMany({
      where: { tenantId, userId },
    });
  },
};
