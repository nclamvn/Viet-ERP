// src/lib/work-session/work-session-service.ts
// Server-side service for Work Session CRUD

import { prisma } from "@/lib/prisma";
import type {
  SessionContext,
  StartSessionInput,
  UpdateContextInput,
  UpdateWorkflowInput,
  TrackActivityInput,
} from "@/types/work-session";

function parseContext(contextJson: unknown): SessionContext {
  const ctx = (contextJson as Record<string, unknown>) || {};
  return {
    summary: (ctx.summary as string) || "",
    completedActions: (ctx.completedActions as string[]) || [],
    pendingActions: (ctx.pendingActions as string[]) || [],
    keyMetrics: (ctx.keyMetrics as Record<string, string | number>) || {},
    blockers: (ctx.blockers as string[]) || undefined,
  };
}

function serializeSession(session: {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  entityNumber: string;
  status: string;
  workflowStep: number;
  workflowTotalSteps: number;
  workflowStepName: string;
  contextSummary: string;
  contextJson: unknown;
  startedAt: Date;
  lastActivityAt: Date;
  pausedAt: Date | null;
  completedAt: Date | null;
  totalActiveTime: number;
  resumeUrl: string;
}) {
  return {
    id: session.id,
    userId: session.userId,
    entityType: session.entityType,
    entityId: session.entityId,
    entityNumber: session.entityNumber,
    status: session.status,
    workflowStep: session.workflowStep,
    workflowTotalSteps: session.workflowTotalSteps,
    workflowStepName: session.workflowStepName,
    context: parseContext(session.contextJson),
    startedAt: session.startedAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    pausedAt: session.pausedAt?.toISOString() || null,
    completedAt: session.completedAt?.toISOString() || null,
    totalActiveTime: session.totalActiveTime,
    resumeUrl: session.resumeUrl,
  };
}

/** Start or resume a work session for an entity */
export async function startSession(userId: string, input: StartSessionInput) {
  // Check if there's already an active/paused session for this entity
  const existing = await prisma.workSession.findFirst({
    where: {
      userId,
      entityType: input.entityType,
      entityId: input.entityId,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
  });

  if (existing) {
    // Resume the existing session
    const updated = await prisma.workSession.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        lastActivityAt: new Date(),
        pausedAt: null,
        resumeUrl: input.resumeUrl,
      },
    });
    return serializeSession(updated);
  }

  // Create a new session
  const session = await prisma.workSession.create({
    data: {
      userId,
      entityType: input.entityType,
      entityId: input.entityId,
      entityNumber: input.entityNumber,
      resumeUrl: input.resumeUrl,
      workflowStep: input.currentStep || 1,
      workflowTotalSteps: input.workflowSteps?.length || 1,
      workflowStepName: input.workflowSteps?.[0] || "",
      contextJson: {
        summary: "",
        completedActions: [],
        pendingActions: [],
        keyMetrics: {},
      },
    },
  });

  return serializeSession(session);
}

/** Pause a work session */
export async function pauseSession(sessionId: string, userId: string) {
  const session = await prisma.workSession.findFirst({
    where: { id: sessionId, userId, status: "ACTIVE" },
  });
  if (!session) return null;

  // Calculate active time increment
  const now = new Date();
  const elapsed = Math.floor(
    (now.getTime() - session.lastActivityAt.getTime()) / 1000,
  );

  const updated = await prisma.workSession.update({
    where: { id: sessionId },
    data: {
      status: "PAUSED",
      pausedAt: now,
      lastActivityAt: now,
      totalActiveTime: session.totalActiveTime + elapsed,
    },
  });

  return serializeSession(updated);
}

/** Resume a paused session */
export async function resumeSession(sessionId: string, userId: string) {
  const updated = await prisma.workSession.update({
    where: { id: sessionId },
    data: {
      status: "ACTIVE",
      pausedAt: null,
      lastActivityAt: new Date(),
    },
  });

  return serializeSession(updated);
}

/** Complete a session */
export async function completeSession(sessionId: string, userId: string) {
  const session = await prisma.workSession.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session) return null;

  const now = new Date();
  const elapsed =
    session.status === "ACTIVE"
      ? Math.floor((now.getTime() - session.lastActivityAt.getTime()) / 1000)
      : 0;

  const updated = await prisma.workSession.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      completedAt: now,
      lastActivityAt: now,
      totalActiveTime: session.totalActiveTime + elapsed,
    },
  });

  return serializeSession(updated);
}

/** Abandon old sessions (auto-cleanup) */
export async function abandonStaleSessions(userId: string, maxAgeHours = 48) {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  await prisma.workSession.updateMany({
    where: {
      userId,
      status: { in: ["ACTIVE", "PAUSED"] },
      lastActivityAt: { lt: cutoff },
    },
    data: {
      status: "ABANDONED",
    },
  });
}

/** Get all active/paused sessions for a user */
export async function getUserSessions(userId: string) {
  // Auto-abandon stale sessions first
  await abandonStaleSessions(userId);

  const sessions = await prisma.workSession.findMany({
    where: {
      userId,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    orderBy: { lastActivityAt: "desc" },
    take: 20,
  });

  return sessions.map(serializeSession);
}

/** Update session context */
export async function updateSessionContext(
  userId: string,
  input: UpdateContextInput,
) {
  const session = await prisma.workSession.findFirst({
    where: { id: input.sessionId, userId },
  });
  if (!session) return null;

  const existingContext = parseContext(session.contextJson);
  const mergedContext = {
    ...existingContext,
    ...input.context,
    keyMetrics: {
      ...existingContext.keyMetrics,
      ...(input.context.keyMetrics || {}),
    },
  };

  const updated = await prisma.workSession.update({
    where: { id: input.sessionId },
    data: {
      contextJson:
        mergedContext as unknown as import(".prisma/mrp-client").Prisma.InputJsonValue,
      contextSummary: mergedContext.summary || existingContext.summary,
      lastActivityAt: new Date(),
    },
  });

  return serializeSession(updated);
}

/** Update workflow step */
export async function updateWorkflowStep(
  userId: string,
  input: UpdateWorkflowInput,
) {
  const data: Record<string, unknown> = {
    workflowStep: input.workflowStep,
    workflowStepName: input.workflowStepName,
    lastActivityAt: new Date(),
  };

  if (input.workflowTotalSteps) {
    data.workflowTotalSteps = input.workflowTotalSteps;
  }

  const updated = await prisma.workSession.update({
    where: { id: input.sessionId },
    data,
  });

  return serializeSession(updated);
}

/** Track an activity within a session */
export async function trackActivity(userId: string, input: TrackActivityInput) {
  // Verify session belongs to user
  const session = await prisma.workSession.findFirst({
    where: { id: input.sessionId, userId },
  });
  if (!session) return null;

  const [activity] = await Promise.all([
    prisma.sessionActivity.create({
      data: {
        sessionId: input.sessionId,
        action: input.action,
        description: input.description,
        metadataJson: input.metadata
          ? (input.metadata as unknown as import(".prisma/mrp-client").Prisma.InputJsonValue)
          : undefined,
      },
    }),
    prisma.workSession.update({
      where: { id: input.sessionId },
      data: { lastActivityAt: new Date() },
    }),
  ]);

  return {
    id: activity.id,
    sessionId: activity.sessionId,
    action: activity.action,
    description: activity.description,
    timestamp: activity.timestamp.toISOString(),
    metadata: activity.metadataJson as Record<string, unknown> | undefined,
  };
}

/** Get recent activities for a user across all sessions */
export async function getRecentActivities(
  userId: string,
  hours = 24,
  limit = 20,
) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const activities = await prisma.sessionActivity.findMany({
    where: {
      session: { userId },
      timestamp: { gte: cutoff },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    include: {
      session: {
        select: {
          entityType: true,
          entityNumber: true,
          entityId: true,
        },
      },
    },
  });

  return activities.map((a) => ({
    id: a.id,
    sessionId: a.sessionId,
    action: a.action,
    description: a.description,
    timestamp: a.timestamp.toISOString(),
    metadata: a.metadataJson as Record<string, unknown> | undefined,
    entityType: a.session.entityType,
    entityNumber: a.session.entityNumber,
    entityId: a.session.entityId,
  }));
}
