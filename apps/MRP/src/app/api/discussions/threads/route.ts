/**
 * API: Discussion Threads
 * GET - Get or create thread by context
 * POST - Create new thread
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ContextType } from ".prisma/mrp-client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/api/with-auth";
import { logger } from "@/lib/logger";

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
export const GET = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkReadEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(request.url);
    const contextType = searchParams.get("contextType");
    const contextId = searchParams.get("contextId");

    if (!contextType || !contextId) {
      return NextResponse.json(
        { error: "contextType and contextId are required" },
        { status: 400 },
      );
    }

    // Find existing thread or create new one
    let thread = await prisma.conversationThread.findFirst({
      where: {
        contextType: contextType as ContextType,
        contextId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        participants: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    if (!thread) {
      // Create new thread
      thread = await prisma.conversationThread.create({
        data: {
          contextType: contextType as ContextType,
          contextId,
          createdById: session.user.id,
          participants: {
            create: {
              userId: session.user.id,
              role: "Creator",
            },
          },
        },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          participants: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
          _count: {
            select: { messages: true },
          },
        },
      });
    } else {
      // Add user as participant if not already
      const isParticipant = thread.participants.some(
        (p) => p.userId === session.user.id,
      );

      if (!isParticipant) {
        await prisma.threadParticipant.create({
          data: {
            threadId: thread.id,
            userId: session.user.id,
          },
        });
      }
    }

    return NextResponse.json({ thread });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/discussions/threads",
    });
    return NextResponse.json(
      { error: "Failed to fetch thread" },
      { status: 500 },
    );
  }
});

export const POST = withAuth(async (request, context, session) => {
  // Rate limiting
  const rateLimitResult = await checkWriteEndpointLimit(request);
  if (rateLimitResult) return rateLimitResult;

  try {
    const bodySchema = z.object({
      contextType: z.string(),
      contextId: z.string(),
      contextTitle: z.string().optional(),
      title: z.string().optional(),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
      initialMessage: z.string().optional(),
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
    const {
      contextType,
      contextId,
      contextTitle,
      title,
      priority,
      initialMessage,
    } = body;

    if (!contextType || !contextId) {
      return NextResponse.json(
        { error: "contextType and contextId are required" },
        { status: 400 },
      );
    }

    // Check if thread already exists
    const existingThread = await prisma.conversationThread.findFirst({
      where: {
        contextType: contextType as ContextType,
        contextId,
      },
    });

    if (existingThread) {
      return NextResponse.json(
        { error: "Thread already exists for this context" },
        { status: 409 },
      );
    }

    // Create thread with optional initial message
    const thread = await prisma.conversationThread.create({
      data: {
        contextType: contextType as ContextType,
        contextId,
        contextTitle,
        title,
        priority: priority || "NORMAL",
        createdById: session.user.id,
        participants: {
          create: {
            userId: session.user.id,
            role: "Creator",
          },
        },
        ...(initialMessage && {
          messages: {
            create: {
              content: initialMessage,
              senderId: session.user.id,
            },
          },
          lastMessageAt: new Date(),
        }),
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        participants: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        messages: {
          include: {
            sender: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        _count: {
          select: { messages: true },
        },
      },
    });

    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "/api/discussions/threads",
    });
    return NextResponse.json(
      { error: "Failed to create thread" },
      { status: 500 },
    );
  }
});
