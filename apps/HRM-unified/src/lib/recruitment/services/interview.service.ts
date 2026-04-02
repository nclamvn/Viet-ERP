// src/lib/recruitment/services/interview.service.ts
// Interview Service - Schedule and manage interviews

import { db } from "@/lib/db";
import {
  InterviewType,
  InterviewResult,
  ApplicationStatus,
  Prisma,
} from ".prisma/hrm-unified-client";

// Types
export interface ScheduleInterviewInput {
  applicationId: string;
  interviewType: InterviewType;
  round?: number;
  scheduledAt: Date;
  duration?: number;
  location?: string;
  interviewerIds: string[];
  notes?: string;
}

export interface UpdateInterviewInput {
  scheduledAt?: Date;
  duration?: number;
  location?: string;
  interviewerIds?: string[];
  result?: InterviewResult;
  notes?: string;
}

export interface InterviewFilters {
  applicationId?: string;
  interviewType?: InterviewType[];
  result?: InterviewResult[];
  interviewerId?: string;
  fromDate?: Date;
  toDate?: Date;
}

export class InterviewService {
  constructor(private tenantId: string) {}

  /**
   * Schedule a new interview
   */
  async schedule(input: ScheduleInterviewInput) {
    // Verify application exists and is in valid status
    const application = await db.application.findFirst({
      where: {
        id: input.applicationId,
        tenantId: this.tenantId,
        status: {
          notIn: [
            ApplicationStatus.REJECTED,
            ApplicationStatus.WITHDRAWN,
            ApplicationStatus.HIRED,
          ],
        },
      },
      include: {
        interviews: {
          orderBy: { round: "desc" },
          take: 1,
        },
      },
    });

    if (!application) {
      throw new Error("Application not found or not in valid status");
    }

    // Determine round number
    const round = input.round || (application.interviews[0]?.round || 0) + 1;

    // Check for scheduling conflicts
    await this.checkConflicts(
      input.scheduledAt,
      input.duration || 60,
      input.interviewerIds,
    );

    const interview = await db.interview.create({
      data: {
        tenantId: this.tenantId,
        applicationId: input.applicationId,
        interviewType: input.interviewType,
        round,
        scheduledAt: input.scheduledAt,
        duration: input.duration || 60,
        location: input.location,
        interviewerIds: input.interviewerIds,
        notes: input.notes,
        result: InterviewResult.PENDING,
      },
      include: {
        application: {
          include: {
            candidate: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
            requisition: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });

    // Update application status to INTERVIEW if not already
    if (application.status !== ApplicationStatus.INTERVIEW) {
      await db.application.update({
        where: { id: input.applicationId },
        data: { status: ApplicationStatus.INTERVIEW, stage: 4 },
      });

      // Create activity
      await db.applicationActivity.create({
        data: {
          applicationId: input.applicationId,
          action: "INTERVIEW_SCHEDULED",
          description: `${input.interviewType} interview scheduled for ${input.scheduledAt.toISOString()}`,
        },
      });
    }

    return interview;
  }

  /**
   * Get interview by ID
   */
  async getById(id: string) {
    const interview = await db.interview.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include: {
        application: {
          include: {
            candidate: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                cvUrl: true,
              },
            },
            requisition: {
              select: {
                id: true,
                title: true,
                requisitionCode: true,
                department: { select: { id: true, name: true } },
              },
            },
          },
        },
        evaluations: {
          include: {
            evaluator: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new Error("Interview not found");
    }

    // Get interviewer details
    const interviewerIds = interview.interviewerIds as string[];
    const interviewers = await db.user.findMany({
      where: { id: { in: interviewerIds } },
      select: { id: true, name: true, email: true },
    });

    return {
      ...interview,
      interviewers,
    };
  }

  /**
   * List interviews with filters
   */
  async list(
    filters: InterviewFilters = {},
    page: number = 1,
    pageSize: number = 20,
  ) {
    const skip = (page - 1) * pageSize;

    const where: Prisma.InterviewWhereInput = {
      tenantId: this.tenantId,
    };

    if (filters.applicationId) {
      where.applicationId = filters.applicationId;
    }

    if (filters.interviewType?.length) {
      where.interviewType = { in: filters.interviewType };
    }

    if (filters.result?.length) {
      where.result = { in: filters.result };
    }

    if (filters.interviewerId) {
      where.interviewerIds = { array_contains: [filters.interviewerId] };
    }

    if (filters.fromDate) {
      where.scheduledAt = { gte: filters.fromDate };
    }

    if (filters.toDate) {
      where.scheduledAt = {
        ...((where.scheduledAt as object) || {}),
        lte: filters.toDate,
      };
    }

    const [interviews, total] = await Promise.all([
      db.interview.findMany({
        where,
        orderBy: { scheduledAt: "asc" },
        skip,
        take: pageSize,
        include: {
          application: {
            include: {
              candidate: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                },
              },
              requisition: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          },
          _count: {
            select: { evaluations: true },
          },
        },
      }),
      db.interview.count({ where }),
    ]);

    // Get interviewer names
    const allInterviewerIds = interviews.flatMap(
      (i) => i.interviewerIds as string[],
    );
    const uniqueInterviewerIds = Array.from(new Set(allInterviewerIds));
    const interviewers = await db.user.findMany({
      where: { id: { in: uniqueInterviewerIds } },
      select: { id: true, name: true },
    });
    const interviewerMap = new Map(interviewers.map((i) => [i.id, i.name]));

    return {
      data: interviews.map((i) => ({
        ...i,
        interviewerNames: (i.interviewerIds as string[]).map(
          (id) => interviewerMap.get(id) || "Unknown",
        ),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Get upcoming interviews for an interviewer
   */
  async getUpcomingForInterviewer(interviewerId: string, limit: number = 10) {
    const interviews = await db.interview.findMany({
      where: {
        tenantId: this.tenantId,
        interviewerIds: { array_contains: [interviewerId] },
        scheduledAt: { gte: new Date() },
        result: InterviewResult.PENDING,
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
      include: {
        application: {
          include: {
            candidate: {
              select: {
                id: true,
                fullName: true,
                email: true,
                cvUrl: true,
              },
            },
            requisition: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });

    return interviews;
  }

  /**
   * Get today's interviews
   */
  async getTodayInterviews() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return db.interview.findMany({
      where: {
        tenantId: this.tenantId,
        scheduledAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      orderBy: { scheduledAt: "asc" },
      include: {
        application: {
          include: {
            candidate: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
              },
            },
            requisition: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Update interview
   */
  async update(id: string, input: UpdateInterviewInput) {
    const interview = await db.interview.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!interview) {
      throw new Error("Interview not found");
    }

    // Check for scheduling conflicts if time is changed
    if (input.scheduledAt || input.interviewerIds) {
      await this.checkConflicts(
        input.scheduledAt || interview.scheduledAt,
        input.duration || interview.duration,
        input.interviewerIds || (interview.interviewerIds as string[]),
        id,
      );
    }

    return db.interview.update({
      where: { id },
      data: {
        scheduledAt: input.scheduledAt,
        duration: input.duration,
        location: input.location,
        interviewerIds: input.interviewerIds,
        result: input.result,
        notes: input.notes,
      },
    });
  }

  /**
   * Reschedule interview
   */
  async reschedule(id: string, newTime: Date, reason?: string) {
    const interview = await db.interview.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!interview) {
      throw new Error("Interview not found");
    }

    if (interview.result !== InterviewResult.PENDING) {
      throw new Error("Cannot reschedule a completed interview");
    }

    await this.checkConflicts(
      newTime,
      interview.duration,
      interview.interviewerIds as string[],
      id,
    );

    const updated = await db.interview.update({
      where: { id },
      data: {
        scheduledAt: newTime,
        result: InterviewResult.RESCHEDULED,
        notes: reason
          ? `${interview.notes || ""}\nRescheduled: ${reason}`
          : interview.notes,
      },
    });

    // Create activity
    await db.applicationActivity.create({
      data: {
        applicationId: interview.applicationId,
        action: "INTERVIEW_RESCHEDULED",
        description: `Interview rescheduled to ${newTime.toISOString()}${reason ? `: ${reason}` : ""}`,
        oldValue: interview.scheduledAt.toISOString(),
        newValue: newTime.toISOString(),
      },
    });

    // Reset result to PENDING
    await db.interview.update({
      where: { id },
      data: { result: InterviewResult.PENDING },
    });

    return updated;
  }

  /**
   * Record interview result
   */
  async recordResult(id: string, result: InterviewResult, notes?: string) {
    const interview = await db.interview.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!interview) {
      throw new Error("Interview not found");
    }

    const updated = await db.interview.update({
      where: { id },
      data: {
        result,
        notes: notes
          ? `${interview.notes || ""}\nResult: ${notes}`
          : interview.notes,
      },
    });

    // Create activity
    await db.applicationActivity.create({
      data: {
        applicationId: interview.applicationId,
        action: "INTERVIEW_COMPLETED",
        description: `Interview completed with result: ${result}`,
        oldValue: InterviewResult.PENDING,
        newValue: result,
      },
    });

    return updated;
  }

  /**
   * Mark as no-show
   */
  async markNoShow(id: string, notes?: string) {
    return this.recordResult(id, InterviewResult.NO_SHOW, notes);
  }

  /**
   * Cancel interview
   */
  async cancel(id: string, reason: string) {
    const interview = await db.interview.findFirst({
      where: { id, tenantId: this.tenantId },
    });

    if (!interview) {
      throw new Error("Interview not found");
    }

    if (interview.result !== InterviewResult.PENDING) {
      throw new Error("Cannot cancel a completed interview");
    }

    // Delete the interview
    await db.interview.delete({ where: { id } });

    // Create activity
    await db.applicationActivity.create({
      data: {
        applicationId: interview.applicationId,
        action: "INTERVIEW_CANCELLED",
        description: `Interview cancelled: ${reason}`,
      },
    });

    return { success: true };
  }

  /**
   * Send reminder (mark as sent)
   */
  async markReminderSent(id: string) {
    return db.interview.update({
      where: { id },
      data: { reminderSent: true },
    });
  }

  /**
   * Get interviews needing reminders
   */
  async getInterviewsNeedingReminders(hoursBeforeInterview: number = 24) {
    const reminderTime = new Date();
    reminderTime.setHours(reminderTime.getHours() + hoursBeforeInterview);

    return db.interview.findMany({
      where: {
        tenantId: this.tenantId,
        scheduledAt: {
          gte: new Date(),
          lte: reminderTime,
        },
        result: InterviewResult.PENDING,
        reminderSent: false,
      },
      include: {
        application: {
          include: {
            candidate: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Check for scheduling conflicts
   */
  private async checkConflicts(
    scheduledAt: Date,
    duration: number,
    interviewerIds: string[],
    excludeId?: string,
  ) {
    const endTime = new Date(scheduledAt.getTime() + duration * 60 * 1000);

    // Check each interviewer
    for (const interviewerId of interviewerIds) {
      const conflicts = await db.interview.findMany({
        where: {
          tenantId: this.tenantId,
          id: excludeId ? { not: excludeId } : undefined,
          interviewerIds: { array_contains: [interviewerId] },
          result: InterviewResult.PENDING,
          OR: [
            {
              // Starts during our interview
              scheduledAt: {
                gte: scheduledAt,
                lt: endTime,
              },
            },
            {
              // Ends during our interview
              AND: [
                { scheduledAt: { lt: scheduledAt } },
                // We need to check if their end time overlaps
              ],
            },
          ],
        },
      });

      if (conflicts.length > 0) {
        const interviewer = await db.user.findUnique({
          where: { id: interviewerId },
          select: { name: true },
        });
        throw new Error(
          `Scheduling conflict: ${interviewer?.name || "Interviewer"} has another interview at this time`,
        );
      }
    }
  }

  /**
   * Get interview statistics
   */
  async getStats(dateRange?: { from: Date; to: Date }) {
    const where: Prisma.InterviewWhereInput = {
      tenantId: this.tenantId,
    };

    if (dateRange) {
      where.scheduledAt = {
        gte: dateRange.from,
        lte: dateRange.to,
      };
    }

    const [total, byType, byResult, upcoming] = await Promise.all([
      db.interview.count({ where }),

      db.interview.groupBy({
        by: ["interviewType"],
        where,
        _count: true,
      }),

      db.interview.groupBy({
        by: ["result"],
        where,
        _count: true,
      }),

      db.interview.count({
        where: {
          ...where,
          scheduledAt: { gte: new Date() },
          result: InterviewResult.PENDING,
        },
      }),
    ]);

    return {
      total,
      upcoming,
      byType: byType.map((t) => ({
        type: t.interviewType,
        count: t._count,
      })),
      byResult: byResult.map((r) => ({
        result: r.result,
        count: r._count,
      })),
    };
  }
}

// Factory function
export function createInterviewService(tenantId: string): InterviewService {
  return new InterviewService(tenantId);
}
