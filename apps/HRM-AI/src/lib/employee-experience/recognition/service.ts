// src/lib/employee-experience/recognition/service.ts
// Recognition & Kudos Service with Points System

import { db } from "@/lib/db";
import { Prisma } from ".prisma/hrm-ai-client";

// Use db as prisma alias for consistency
const prisma = db;

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface GiveRecognitionInput {
  tenantId: string;
  giverId: string;
  receiverId: string;
  categoryId: string;
  message: string;
  isPublic?: boolean;
}

export interface RecognitionWithDetails {
  id: string;
  message: string;
  isPublic: boolean;
  pointsAwarded: number;
  createdAt: Date;
  giver: {
    id: string;
    fullName: string;
    avatar: string | null;
    position?: { name: string } | null;
    department?: { name: string } | null;
  };
  receiver: {
    id: string;
    fullName: string;
    avatar: string | null;
    position?: { name: string } | null;
    department?: { name: string } | null;
  };
  category: {
    id: string;
    name: string;
    nameVi: string;
    icon: string | null;
    color: string | null;
    pointsValue: number;
  };
  reactions: Array<{
    id: string;
    emoji: string;
    employee: { id: string; fullName: string };
  }>;
  comments: Array<{
    id: string;
    content: string;
    createdAt: Date;
    author: { id: string; fullName: string; avatar: string | null };
  }>;
  _count: { comments: number; reactions: number };
}

export interface EmployeePointsStats {
  balance: number;
  totalEarned: number;
  monthlyAllowance: number;
  monthlyRemaining: number;
}

export interface LeaderboardEntry {
  rank: number;
  employee: {
    id: string;
    fullName: string;
    avatar: string | null;
    position?: { name: string } | null;
    department?: { name: string } | null;
  } | null;
  count: number;
  points?: number;
}

// ═══════════════════════════════════════════════════════════════
// RECOGNITION SERVICE
// ═══════════════════════════════════════════════════════════════

export class RecognitionService {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  // ─────────────────────────────────────────────────────────────
  // Give Recognition
  // ─────────────────────────────────────────────────────────────

  async giveRecognition(input: GiveRecognitionInput): Promise<string> {
    const { giverId, receiverId, categoryId, message, isPublic = true } = input;

    if (giverId === receiverId) {
      throw new Error("Không thể gửi kudos cho chính mình");
    }

    // Get category
    const category = await prisma.recognitionCategory.findFirst({
      where: { id: categoryId, tenantId: this.tenantId },
    });

    if (!category || !category.isActive) {
      throw new Error("Danh mục không hợp lệ");
    }

    // Check giver's monthly allowance
    const giverPoints = await this.getOrCreatePoints(giverId);

    // Reset allowance if new month
    const now = new Date();
    if (
      !giverPoints.allowanceResetAt ||
      giverPoints.allowanceResetAt.getMonth() !== now.getMonth()
    ) {
      await prisma.employeePoints.update({
        where: { id: giverPoints.id },
        data: {
          monthlyUsed: 0,
          allowanceResetAt: now,
        },
      });
      giverPoints.monthlyUsed = 0;
    }

    const remainingAllowance =
      giverPoints.monthlyAllowance - giverPoints.monthlyUsed;
    if (remainingAllowance < category.pointsValue) {
      throw new Error(
        `Bạn đã hết điểm kudos tháng này. Còn lại: ${remainingAllowance} điểm`,
      );
    }

    // Create recognition
    const recognition = await prisma.recognition.create({
      data: {
        tenantId: this.tenantId,
        giverId,
        receiverId,
        categoryId,
        message,
        isPublic,
        pointsAwarded: category.pointsValue,
      },
      include: {
        giver: { select: { id: true, fullName: true, avatar: true } },
        receiver: { select: { id: true, fullName: true, avatar: true } },
        category: true,
      },
    });

    // Update giver's monthly usage
    await prisma.employeePoints.update({
      where: { id: giverPoints.id },
      data: {
        monthlyUsed: { increment: category.pointsValue },
      },
    });

    // Add to receiver's balance
    const receiverPoints = await this.getOrCreatePoints(receiverId);
    await prisma.employeePoints.update({
      where: { id: receiverPoints.id },
      data: {
        totalEarned: { increment: category.pointsValue },
        currentBalance: { increment: category.pointsValue },
      },
    });

    // Create point transactions
    await prisma.pointTransaction.createMany({
      data: [
        {
          employeePointsId: giverPoints.id,
          type: "GAVE_RECOGNITION",
          amount: -category.pointsValue,
          description: `Gửi kudos cho ${recognition.receiver.fullName}`,
          referenceType: "recognition",
          referenceId: recognition.id,
        },
        {
          employeePointsId: receiverPoints.id,
          type: "EARNED_RECOGNITION",
          amount: category.pointsValue,
          description: `Nhận kudos từ ${recognition.giver.fullName}`,
          referenceType: "recognition",
          referenceId: recognition.id,
        },
      ],
    });

    return recognition.id;
  }

  // ─────────────────────────────────────────────────────────────
  // Recognition Wall / Feed
  // ─────────────────────────────────────────────────────────────

  async getRecognitionWall(options?: {
    limit?: number;
    cursor?: string;
    departmentId?: string;
  }): Promise<{
    items: RecognitionWithDetails[];
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const { limit = 20, cursor, departmentId } = options || {};

    const where: Prisma.RecognitionWhereInput = {
      tenantId: this.tenantId,
      isPublic: true,
    };

    if (departmentId) {
      where.OR = [{ giver: { departmentId } }, { receiver: { departmentId } }];
    }

    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const recognitions = await prisma.recognition.findMany({
      where,
      include: {
        giver: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
            position: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        receiver: {
          select: {
            id: true,
            fullName: true,
            avatar: true,
            position: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        category: true,
        reactions: {
          include: {
            employee: { select: { id: true, fullName: true } },
          },
        },
        comments: {
          include: {
            author: { select: { id: true, fullName: true, avatar: true } },
          },
          orderBy: { createdAt: "asc" },
          take: 3,
        },
        _count: {
          select: { comments: true, reactions: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = recognitions.length > limit;
    const items = hasMore ? recognitions.slice(0, -1) : recognitions;

    return {
      items: items as RecognitionWithDetails[],
      hasMore,
      nextCursor: hasMore
        ? items[items.length - 1].createdAt.toISOString()
        : null,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Employee Stats
  // ─────────────────────────────────────────────────────────────

  async getEmployeeStats(employeeId: string): Promise<{
    given: number;
    received: number;
    points: EmployeePointsStats;
    recentReceived: Array<{
      id: string;
      message: string;
      createdAt: Date;
      giver: { id: string; fullName: string; avatar: string | null };
      category: { name: string; nameVi: string; icon: string | null };
    }>;
    breakdown: Array<{
      category: {
        name: string;
        nameVi: string;
        icon: string | null;
        color: string | null;
      } | null;
      count: number;
    }>;
  }> {
    const [given, received, points] = await Promise.all([
      prisma.recognition.count({
        where: { tenantId: this.tenantId, giverId: employeeId },
      }),
      prisma.recognition.count({
        where: { tenantId: this.tenantId, receiverId: employeeId },
      }),
      this.getOrCreatePoints(employeeId),
    ]);

    // Get recent recognitions received
    const recentReceived = await prisma.recognition.findMany({
      where: { tenantId: this.tenantId, receiverId: employeeId },
      include: {
        giver: { select: { id: true, fullName: true, avatar: true } },
        category: { select: { name: true, nameVi: true, icon: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    // Get recognition breakdown by category
    const categoryBreakdown = await prisma.recognition.groupBy({
      by: ["categoryId"],
      where: { tenantId: this.tenantId, receiverId: employeeId },
      _count: { id: true },
    });

    const categories = await prisma.recognitionCategory.findMany({
      where: { id: { in: categoryBreakdown.map((c) => c.categoryId) } },
      select: { id: true, name: true, nameVi: true, icon: true, color: true },
    });

    const breakdown = categoryBreakdown.map((cb) => ({
      category: categories.find((c) => c.id === cb.categoryId) || null,
      count: cb._count.id,
    }));

    return {
      given,
      received,
      points: {
        balance: points.currentBalance,
        totalEarned: points.totalEarned,
        monthlyAllowance: points.monthlyAllowance,
        monthlyRemaining: points.monthlyAllowance - points.monthlyUsed,
      },
      recentReceived,
      breakdown,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Reactions & Comments
  // ─────────────────────────────────────────────────────────────

  async addReaction(
    recognitionId: string,
    employeeId: string,
    emoji: string,
  ): Promise<void> {
    await prisma.recognitionReaction.upsert({
      where: {
        recognitionId_employeeId: { recognitionId, employeeId },
      },
      update: { emoji },
      create: { recognitionId, employeeId, emoji },
    });
  }

  async removeReaction(
    recognitionId: string,
    employeeId: string,
  ): Promise<void> {
    await prisma.recognitionReaction.deleteMany({
      where: { recognitionId, employeeId },
    });
  }

  async addComment(
    recognitionId: string,
    authorId: string,
    content: string,
  ): Promise<string> {
    const comment = await prisma.recognitionComment.create({
      data: { recognitionId, authorId, content },
    });

    return comment.id;
  }

  // ─────────────────────────────────────────────────────────────
  // Leaderboard
  // ─────────────────────────────────────────────────────────────

  async getLeaderboard(
    type: "received" | "given" = "received",
    limit: number = 10,
  ): Promise<LeaderboardEntry[]> {
    if (type === "received") {
      const leaders = await prisma.recognition.groupBy({
        by: ["receiverId"],
        where: { tenantId: this.tenantId },
        _count: { id: true },
        _sum: { pointsAwarded: true },
        orderBy: { _sum: { pointsAwarded: "desc" } },
        take: limit,
      });

      const employees = await prisma.employee.findMany({
        where: { id: { in: leaders.map((l) => l.receiverId) } },
        select: {
          id: true,
          fullName: true,
          avatar: true,
          position: { select: { name: true } },
          department: { select: { name: true } },
        },
      });

      return leaders.map((l, index) => ({
        rank: index + 1,
        employee: employees.find((e) => e.id === l.receiverId) || null,
        count: l._count.id,
        points: l._sum.pointsAwarded || 0,
      }));
    }

    // Given leaderboard
    const leaders = await prisma.recognition.groupBy({
      by: ["giverId"],
      where: { tenantId: this.tenantId },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: limit,
    });

    const employees = await prisma.employee.findMany({
      where: { id: { in: leaders.map((l) => l.giverId) } },
      select: {
        id: true,
        fullName: true,
        avatar: true,
        position: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    return leaders.map((l, index) => ({
      rank: index + 1,
      employee: employees.find((e) => e.id === l.giverId) || null,
      count: l._count.id,
    }));
  }

  // ─────────────────────────────────────────────────────────────
  // Categories
  // ─────────────────────────────────────────────────────────────

  async getCategories() {
    return prisma.recognitionCategory.findMany({
      where: { tenantId: this.tenantId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  async seedDefaultCategories(): Promise<void> {
    const defaultCategories = [
      {
        name: "Team Player",
        nameVi: "Tinh thần đồng đội",
        description: "Hỗ trợ đồng nghiệp, làm việc nhóm hiệu quả",
        icon: "🤝",
        color: "#3B82F6",
        pointsValue: 10,
        sortOrder: 1,
      },
      {
        name: "Innovation",
        nameVi: "Sáng tạo",
        description: "Đưa ra ý tưởng mới, cải tiến quy trình",
        icon: "💡",
        color: "#F59E0B",
        pointsValue: 15,
        sortOrder: 2,
      },
      {
        name: "Going Above & Beyond",
        nameVi: "Vượt xa kỳ vọng",
        description: "Nỗ lực vượt trội, làm việc extra mile",
        icon: "🚀",
        color: "#8B5CF6",
        pointsValue: 20,
        sortOrder: 3,
      },
      {
        name: "Problem Solver",
        nameVi: "Giải quyết vấn đề",
        description: "Tìm ra giải pháp cho các vấn đề khó",
        icon: "🔧",
        color: "#10B981",
        pointsValue: 15,
        sortOrder: 4,
      },
      {
        name: "Customer Focus",
        nameVi: "Tận tâm với khách hàng",
        description: "Chăm sóc khách hàng xuất sắc",
        icon: "⭐",
        color: "#EC4899",
        pointsValue: 15,
        sortOrder: 5,
      },
      {
        name: "Mentorship",
        nameVi: "Hướng dẫn & Đào tạo",
        description: "Hỗ trợ, hướng dẫn đồng nghiệp phát triển",
        icon: "🎓",
        color: "#6366F1",
        pointsValue: 15,
        sortOrder: 6,
      },
      {
        name: "Thank You",
        nameVi: "Cảm ơn",
        description: "Ghi nhận sự giúp đỡ, hỗ trợ",
        icon: "🙏",
        color: "#14B8A6",
        pointsValue: 5,
        sortOrder: 7,
      },
      {
        name: "Great Job",
        nameVi: "Làm tốt lắm",
        description: "Hoàn thành công việc xuất sắc",
        icon: "👏",
        color: "#F97316",
        pointsValue: 10,
        sortOrder: 8,
      },
    ];

    for (const category of defaultCategories) {
      await prisma.recognitionCategory.upsert({
        where: {
          tenantId_name: { tenantId: this.tenantId, name: category.name },
        },
        update: category,
        create: { tenantId: this.tenantId, ...category },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Points Management
  // ─────────────────────────────────────────────────────────────

  private async getOrCreatePoints(employeeId: string) {
    let points = await prisma.employeePoints.findUnique({
      where: { employeeId },
    });

    if (!points) {
      points = await prisma.employeePoints.create({
        data: {
          employeeId,
          monthlyAllowance: 100,
          allowanceResetAt: new Date(),
        },
      });
    }

    return points;
  }

  async getPointTransactions(employeeId: string, limit: number = 20) {
    const points = await this.getOrCreatePoints(employeeId);

    return prisma.pointTransaction.findMany({
      where: { employeePointsId: points.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTION
// ═══════════════════════════════════════════════════════════════

export function createRecognitionService(tenantId: string): RecognitionService {
  return new RecognitionService(tenantId);
}
