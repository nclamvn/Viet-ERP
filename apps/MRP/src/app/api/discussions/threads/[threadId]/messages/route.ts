/**
 * API: Thread Messages
 * GET - Get messages for thread
 * POST - Create new message with attachments and entity links
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
import { notifyMentions, notifyReply } from "@/lib/notifications";
import { broadcastNewMessage } from "@/lib/socket/emit";
import { AttachmentType, LinkedEntityType } from ".prisma/mrp-client";
import { logger } from "@/lib/logger";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
interface RouteContext {
  params: Promise<{ threadId: string }>;
}

export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { threadId } = await context.params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const cursor = searchParams.get("cursor");

    // Check if thread exists
    const thread = await prisma.conversationThread.findUnique({
      where: { id: threadId },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    // Fetch messages with cursor-based pagination
    const messages = await prisma.message.findMany({
      where: { threadId },
      include: {
        sender: {
          select: { id: true, name: true, email: true },
        },
        attachments: true,
        editHistory: {
          orderBy: { editedAt: "desc" },
        },
        entityLinks: true,
        mentions: {
          include: {
            user: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      ...(cursor && {
        skip: 1,
        cursor: { id: cursor },
      }),
    });

    // Update participant's last read
    await prisma.threadParticipant.updateMany({
      where: {
        threadId,
        userId: session.user.id,
      },
      data: {
        lastReadAt: new Date(),
        lastReadMessageId: messages[messages.length - 1]?.id,
      },
    });

    return NextResponse.json({
      messages,
      nextCursor:
        messages.length === limit ? messages[messages.length - 1]?.id : null,
    });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/discussions/threads/[threadId]/messages",
    });
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 },
    );
  }
});

export const POST = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { threadId } = await context.params;
    const bodySchema = z.object({
      content: z.string().optional(),
      attachments: z
        .array(
          z.object({
            type: z.nativeEnum(AttachmentType),
            filename: z.string(),
            fileUrl: z.string(),
            fileSize: z.number().optional(),
            mimeType: z.string().optional(),
            width: z.number().optional(),
            height: z.number().optional(),
            thumbnailUrl: z.string().optional(),
            capturedContext: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .default([]),
      entityLinks: z
        .array(
          z.object({
            entityType: z.nativeEnum(LinkedEntityType),
            entityId: z.string(),
            entityTitle: z.string().optional(),
            entitySubtitle: z.string().optional(),
            entityIcon: z.string().optional(),
            entityStatus: z.string().optional(),
          }),
        )
        .default([]),
      mentions: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            startIndex: z.number().optional(),
            endIndex: z.number().optional(),
          }),
        )
        .default([]),
    });

    const rawBody = await request.json();
    const parseResult = bodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid input",
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    const body = parseResult.data;
    const { content, attachments, entityLinks, mentions } = body;

    // Validate input
    if (
      !content?.trim() &&
      attachments.length === 0 &&
      entityLinks.length === 0
    ) {
      return NextResponse.json(
        { error: "Message must have content, attachments, or entity links" },
        { status: 400 },
      );
    }

    // Check if thread exists and is not archived
    const thread = await prisma.conversationThread.findUnique({
      where: { id: threadId },
    });

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    if (thread.status === "ARCHIVED") {
      return NextResponse.json(
        { error: "Cannot send messages to archived thread" },
        { status: 403 },
      );
    }

    // Create message with attachments and entity links
    const message = await prisma.message.create({
      data: {
        threadId,
        senderId: session.user.id,
        content: content?.trim() || "",
        attachments: {
          create: attachments.map((att) => ({
            type: att.type,
            filename: att.filename,
            fileUrl: att.fileUrl,
            fileSize: att.fileSize ?? 0,
            mimeType: att.mimeType ?? "application/octet-stream",
            width: att.width,
            height: att.height,
            thumbnailUrl: att.thumbnailUrl,
            capturedContext: att.capturedContext
              ? JSON.stringify(att.capturedContext)
              : null,
            uploadedById: session.user.id,
          })),
        },
        entityLinks: {
          create: entityLinks.map((link) => ({
            entityType: link.entityType,
            entityId: link.entityId,
            entityTitle: link.entityTitle ?? "",
            entitySubtitle: link.entitySubtitle,
            entityIcon: link.entityIcon,
            entityStatus: link.entityStatus,
          })),
        },
      },
      include: {
        sender: {
          select: { id: true, name: true, email: true },
        },
        attachments: true,
        entityLinks: true,
      },
    });

    // Update thread's lastMessageAt
    await prisma.conversationThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    });

    // Ensure sender is a participant
    await prisma.threadParticipant.upsert({
      where: {
        threadId_userId: {
          threadId,
          userId: session.user.id,
        },
      },
      update: {
        lastReadAt: new Date(),
        lastReadMessageId: message.id,
      },
      create: {
        threadId,
        userId: session.user.id,
        lastReadAt: new Date(),
        lastReadMessageId: message.id,
      },
    });

    // Handle mentions and notifications (async, don't block response)
    const senderName = session.user.name || session.user.email || "Someone";
    const mentionedUserIds = mentions.map((m: { id: string }) => m.id);

    if (mentions.length > 0) {
      notifyMentions({
        messageId: message.id,
        threadId,
        mentionedUsers: mentions as unknown as {
          id: string;
          name: string;
          startIndex: number;
          endIndex: number;
        }[],
        mentionedById: session.user.id,
        mentionedByName: senderName,
      }).catch((err) =>
        logger.error("Failed to notify mentions:", {
          context: "/api/discussions/threads/[threadId]/messages",
          details: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Notify other participants about the reply (excluding mentioned users to avoid duplicates)
    notifyReply({
      threadId,
      messageId: message.id,
      senderId: session.user.id,
      senderName,
      excludeUserIds: mentionedUserIds,
    }).catch((err) =>
      logger.error("Failed to notify reply:", {
        context: "/api/discussions/threads/[threadId]/messages",
        details: err instanceof Error ? err.message : String(err),
      }),
    );

    // Broadcast new message via Socket.io
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messageWithRelations = message as any;
    try {
      broadcastNewMessage(threadId, {
        id: message.id,
        threadId,
        content: message.content,
        senderId: message.senderId,
        sender: messageWithRelations.sender,
        attachments: messageWithRelations.attachments,
        entityLinks: messageWithRelations.entityLinks,
        createdAt: message.createdAt.toISOString(),
      });
    } catch (err) {
      logger.error("Failed to broadcast message", {
        context: "/api/discussions/threads/[threadId]/messages",
        details: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/discussions/threads/[threadId]/messages",
    });
    return NextResponse.json(
      { error: "Failed to create message" },
      { status: 500 },
    );
  }
});
