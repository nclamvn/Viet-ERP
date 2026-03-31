// ============================================================
// @vierp/ai-copilot — Conversational Engine
// Core engine that handles LLM interaction, tool use, streaming
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type {
  CopilotConfig,
  ConversationContext,
  ChatMessage,
  CopilotResponse,
  CopilotTool,
  StreamChunk,
  ModuleAssistant,
} from '../types';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;

export class CopilotEngine {
  private client: Anthropic;
  private config: CopilotConfig;
  private assistants: Map<string, ModuleAssistant> = new Map();

  constructor(config: CopilotConfig) {
    this.config = config;
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  /**
   * Register a module-specific assistant
   */
  registerAssistant(assistant: ModuleAssistant): void {
    this.assistants.set(assistant.module, assistant);
    console.log(`[AI-COPILOT] Registered assistant: ${assistant.module}`);
  }

  /**
   * Send a message and get a response (non-streaming)
   */
  async chat(
    message: string,
    context: ConversationContext
  ): Promise<CopilotResponse> {
    const assistant = this.assistants.get(context.module);
    const systemPrompt = await this.buildSystemPrompt(context, assistant);
    const tools = this.getToolsForModule(context.module, assistant);

    // Build message history
    const messages = this.buildMessages(context.history, message);

    // Call Anthropic
    const response = await this.client.messages.create({
      model: this.config.model || DEFAULT_MODEL,
      max_tokens: this.config.maxTokens || DEFAULT_MAX_TOKENS,
      temperature: this.config.temperature || 0.3,
      system: systemPrompt,
      messages,
      tools: tools.length > 0 ? tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      })) : undefined,
    });

    // Process response — handle tool use loop
    return this.processResponse(response, context, tools);
  }

  /**
   * Stream a response (for real-time UI)
   */
  async *stream(
    message: string,
    context: ConversationContext
  ): AsyncGenerator<StreamChunk> {
    const assistant = this.assistants.get(context.module);
    const systemPrompt = await this.buildSystemPrompt(context, assistant);
    const tools = this.getToolsForModule(context.module, assistant);
    const messages = this.buildMessages(context.history, message);

    const stream = this.client.messages.stream({
      model: this.config.model || DEFAULT_MODEL,
      max_tokens: this.config.maxTokens || DEFAULT_MAX_TOKENS,
      temperature: this.config.temperature || 0.3,
      system: systemPrompt,
      messages,
      tools: tools.length > 0 ? tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      })) : undefined,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === 'text_delta') {
          yield { type: 'text', content: delta.text as string };
        }
      }
    }

    yield { type: 'done' };
  }

  // ==================== Internal Methods ====================

  private async buildSystemPrompt(
    context: ConversationContext,
    assistant?: ModuleAssistant
  ): Promise<string> {
    const lang = context.language || this.config.language || 'vi';
    const isVi = lang === 'vi';

    let prompt = isVi
      ? `Bạn là AI Copilot của hệ thống ERP doanh nghiệp sản xuất Việt Nam.\n`
      : `You are the AI Copilot for a Vietnamese manufacturing enterprise ERP system.\n`;

    // Tenant context
    prompt += isVi
      ? `Tenant: ${context.tenantId} | Tier: ${context.tier} | Module: ${context.module}\n`
      : `Tenant: ${context.tenantId} | Tier: ${context.tier} | Module: ${context.module}\n`;

    // Module-specific prompt
    if (assistant) {
      prompt += `\n${assistant.systemPrompt}\n`;

      // Build context from assistant's context builder
      try {
        const moduleContext = await assistant.contextBuilder(context);
        if (moduleContext) {
          prompt += `\n--- Module Context ---\n${moduleContext}\n`;
        }
      } catch (error) {
        console.warn(`[AI-COPILOT] Context builder failed for ${context.module}:`, error);
      }
    }

    // General instructions
    prompt += isVi
      ? `\n--- Quy tắc ---
- Trả lời bằng tiếng Việt, chuyên nghiệp, súc tích
- Sử dụng thuật ngữ kế toán/sản xuất Việt Nam khi cần
- Nếu cần dữ liệu, sử dụng tools để truy vấn
- Định dạng số theo chuẩn Việt Nam (1.000.000 VND)
- Không bịa dữ liệu — nếu không biết, nói không biết
- Đề xuất hành động cụ thể khi có thể`
      : `\n--- Rules ---
- Respond professionally and concisely
- Use Vietnamese accounting/manufacturing terminology when relevant
- Use tools to query data when needed
- Format numbers in Vietnamese standard (1.000.000 VND)
- Never fabricate data — if uncertain, say so
- Suggest specific actions when possible`;

    return prompt;
  }

  private buildMessages(
    history: ChatMessage[],
    newMessage: string
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history (last 20 messages to stay within context)
    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add new user message
    messages.push({ role: 'user', content: newMessage });

    return messages;
  }

  private getToolsForModule(module: string, assistant?: ModuleAssistant): CopilotTool[] {
    const tools: CopilotTool[] = [];

    // Module-specific tools
    if (assistant?.tools) {
      tools.push(...assistant.tools);
    }

    return tools;
  }

  private async processResponse(
    response: Anthropic.Message,
    context: ConversationContext,
    tools: CopilotTool[]
  ): Promise<CopilotResponse> {
    let textContent = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    const toolResults: Array<{ toolCallId: string; name: string; content: string }> = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });

        // Execute the tool
        const tool = tools.find(t => t.name === block.name);
        if (tool) {
          try {
            const result = await tool.execute(block.input as Record<string, unknown>, context);
            toolResults.push({
              toolCallId: block.id,
              name: block.name,
              content: result,
            });
          } catch (error) {
            toolResults.push({
              toolCallId: block.id,
              name: block.name,
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      }
    }

    // If there were tool calls, make a follow-up request with results
    if (toolCalls.length > 0 && toolResults.length > 0) {
      const followUp = await this.client.messages.create({
        model: this.config.model || DEFAULT_MODEL,
        max_tokens: this.config.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: this.config.temperature || 0.3,
        system: await this.buildSystemPrompt(context, this.assistants.get(context.module)),
        messages: [
          ...this.buildMessages(context.history, context.history[context.history.length - 1]?.content || ''),
          {
            role: 'assistant',
            content: response.content as Anthropic.ContentBlock[],
          },
          {
            role: 'user',
            content: toolResults.map(r => ({
              type: 'tool_result' as const,
              tool_use_id: r.toolCallId,
              content: r.content,
            })),
          },
        ],
      });

      // Extract text from follow-up
      for (const block of followUp.content) {
        if (block.type === 'text') {
          textContent = block.text; // Replace with final response
        }
      }
    }

    const assistantMessage: ChatMessage = {
      id: `msg_${Date.now().toString(36)}`,
      role: 'assistant',
      content: textContent,
      timestamp: new Date(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
    };

    return {
      message: assistantMessage,
      confidence: response.stop_reason === 'end_turn' ? 0.95 : 0.7,
    };
  }
}
