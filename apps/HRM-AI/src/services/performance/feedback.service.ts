import { db } from "@/lib/db";
import type { Prisma } from ".prisma/hrm-ai-client";

export async function requestFeedback(
  tenantId: string,
  requesterId: string,
  data: {
    subjectId: string;
    providerIds: string[];
    feedbackType:
      | "CONTINUOUS"
      | "REVIEW_360"
      | "PEER"
      | "UPWARD"
      | "RECOGNITION";
    reviewId?: string;
    dueDate?: Date;
    questions?: string[];
  },
) {
  const requests = await db.$transaction(
    data.providerIds.map((providerId) =>
      db.feedbackRequest.create({
        data: {
          tenantId,
          requesterId,
          providerId,
          subjectId: data.subjectId,
          feedbackType: data.feedbackType,
          reviewId: data.reviewId,
          dueDate: data.dueDate,
          questions: data.questions as any,
          status: "REQUESTED",
        },
        include: {
          provider: {
            select: { id: true, name: true },
          },
          subject: {
            select: { id: true, fullName: true },
          },
        },
      }),
    ),
  );

  return requests;
}

export async function getFeedbackRequests(
  tenantId: string,
  filters?: {
    providerId?: string;
    subjectId?: string;
    requesterId?: string;
    reviewId?: string;
    status?: "REQUESTED" | "PENDING" | "SUBMITTED" | "DECLINED";
    feedbackType?: string;
  },
) {
  const where: Prisma.FeedbackRequestWhereInput = {
    tenantId,
    ...(filters?.providerId && { providerId: filters.providerId }),
    ...(filters?.subjectId && { subjectId: filters.subjectId }),
    ...(filters?.requesterId && { requesterId: filters.requesterId }),
    ...(filters?.reviewId && { reviewId: filters.reviewId }),
    ...(filters?.status && { status: filters.status }),
    ...(filters?.feedbackType && { feedbackType: filters.feedbackType as any }),
  };

  return db.feedbackRequest.findMany({
    where,
    include: {
      requester: {
        select: { id: true, name: true },
      },
      provider: {
        select: { id: true, name: true },
      },
      subject: {
        select: { id: true, fullName: true },
      },
      response: true,
    },
    orderBy: { requestedAt: "desc" },
  });
}

export async function submitFeedback(
  tenantId: string,
  providerId: string,
  data: {
    requestId?: string;
    subjectId: string;
    feedbackType:
      | "CONTINUOUS"
      | "REVIEW_360"
      | "PEER"
      | "UPWARD"
      | "RECOGNITION";
    overallRating?: number;
    ratings?: Record<string, number>;
    strengths?: string;
    areasForImprovement?: string;
    comments?: string;
    recognitionType?: string;
    isPublic?: boolean;
    isAnonymous?: boolean;
  },
) {
  const feedback = await db.feedback.create({
    data: {
      tenantId,
      requestId: data.requestId,
      providerId,
      subjectId: data.subjectId,
      feedbackType: data.feedbackType,
      overallRating: data.overallRating,
      ratings: data.ratings as any,
      strengths: data.strengths,
      areasForImprovement: data.areasForImprovement,
      comments: data.comments,
      recognitionType: data.recognitionType,
      isPublic: data.isPublic ?? false,
      isAnonymous: data.isAnonymous ?? false,
    },
    include: {
      subject: {
        select: { id: true, fullName: true },
      },
    },
  });

  // Update request status if linked
  if (data.requestId) {
    await db.feedbackRequest.update({
      where: { id: data.requestId },
      data: {
        status: "SUBMITTED",
        respondedAt: new Date(),
      },
    });
  }

  return feedback;
}

export async function getFeedbackForEmployee(
  tenantId: string,
  subjectId: string,
  options?: {
    feedbackType?: string;
    startDate?: Date;
    endDate?: Date;
    includeAnonymous?: boolean;
    requesterId?: string;
  },
) {
  const where: Prisma.FeedbackWhereInput = {
    tenantId,
    subjectId,
    ...(options?.feedbackType && { feedbackType: options.feedbackType as any }),
    ...(options?.startDate &&
      options?.endDate && {
        createdAt: {
          gte: options.startDate,
          lte: options.endDate,
        },
      }),
  };

  const feedbacks = await db.feedback.findMany({
    where,
    include: {
      provider: {
        select: { id: true, name: true },
      },
      subject: {
        select: { id: true, fullName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Mask anonymous feedback provider info
  return feedbacks.map((feedback) => {
    if (feedback.isAnonymous) {
      return {
        ...feedback,
        providerId: "anonymous",
        provider: null,
      };
    }
    return feedback;
  });
}

export async function declineFeedbackRequest(
  requestId: string,
  providerId: string,
) {
  const request = await db.feedbackRequest.findFirst({
    where: { id: requestId, providerId },
  });

  if (!request) {
    throw new Error("Feedback request not found or access denied");
  }

  return db.feedbackRequest.update({
    where: { id: requestId },
    data: {
      status: "DECLINED",
      respondedAt: new Date(),
    },
    include: {
      subject: {
        select: { id: true, fullName: true },
      },
      requester: {
        select: { id: true, name: true },
      },
    },
  });
}

export async function getRecognitions(
  tenantId: string,
  options?: {
    limit?: number;
    offset?: number;
    subjectId?: string;
    providerId?: string;
  },
) {
  const where: Prisma.FeedbackWhereInput = {
    tenantId,
    feedbackType: "RECOGNITION",
    isPublic: true,
    ...(options?.subjectId && { subjectId: options.subjectId }),
    ...(options?.providerId && { providerId: options.providerId }),
  };

  const [data, total] = await Promise.all([
    db.feedback.findMany({
      where,
      include: {
        provider: {
          select: { id: true, name: true },
        },
        subject: {
          select: { id: true, fullName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: options?.offset ?? 0,
      take: options?.limit ?? 20,
    }),
    db.feedback.count({ where }),
  ]);

  // Mask anonymous recognitions
  const maskedData = data.map((feedback) => {
    if (feedback.isAnonymous) {
      return {
        ...feedback,
        providerId: "anonymous",
        provider: null,
      };
    }
    return feedback;
  });

  return {
    data: maskedData,
    total,
  };
}
