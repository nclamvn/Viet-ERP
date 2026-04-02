// src/lib/ai/hr-copilot.ts
// HR Copilot Orchestrator - Main AI Assistant Engine

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { AIIntentType } from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CopilotContext {
  tenantId: string;
  userId: string;
  employeeId?: string;
  employee?: {
    code: string;
    name: string;
    department: string;
    position: string;
    managerId?: string;
  };
  role: string;
  leaveBalances?: Array<{
    type: string;
    available: number;
    total: number;
  }>;
  pendingApprovals?: number;
}

export interface CopilotMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CopilotResponse {
  message: string;
  intent: AIIntentType;
  actions?: CopilotAction[];
  suggestions?: string[];
  sources?: string[];
}

export interface CopilotAction {
  type: string;
  params: Record<string, unknown>;
  label: string;
  url?: string;
}

// ═══════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const HR_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_leave_balance",
    description:
      "Lấy số ngày phép còn lại của nhân viên. Sử dụng khi người dùng hỏi về ngày phép, số phép còn lại.",
    input_schema: {
      type: "object" as const,
      properties: {
        year: {
          type: "number",
          description: "Năm cần tra cứu. Mặc định là năm hiện tại.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_attendance_summary",
    description:
      "Lấy thống kê chấm công trong khoảng thời gian. Sử dụng khi hỏi về ngày công, giờ làm, đi muộn.",
    input_schema: {
      type: "object" as const,
      properties: {
        startDate: {
          type: "string",
          description: "Ngày bắt đầu (YYYY-MM-DD)",
        },
        endDate: {
          type: "string",
          description: "Ngày kết thúc (YYYY-MM-DD)",
        },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "Tìm kiếm trong cơ sở kiến thức nội bộ về chính sách, quy định công ty.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Từ khóa tìm kiếm về chính sách/quy định",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_leave_request",
    description:
      "Tạo đơn xin nghỉ phép. CHỈ gọi khi người dùng YÊU CẦU TẠO ĐƠN với đầy đủ thông tin.",
    input_schema: {
      type: "object" as const,
      properties: {
        leaveType: {
          type: "string",
          enum: [
            "ANNUAL",
            "SICK",
            "PERSONAL",
            "WEDDING",
            "BEREAVEMENT",
            "MATERNITY",
            "UNPAID",
          ],
          description: "Loại nghỉ phép",
        },
        startDate: {
          type: "string",
          description: "Ngày bắt đầu (YYYY-MM-DD)",
        },
        endDate: {
          type: "string",
          description: "Ngày kết thúc (YYYY-MM-DD)",
        },
        reason: {
          type: "string",
          description: "Lý do xin nghỉ",
        },
      },
      required: ["leaveType", "startDate", "endDate", "reason"],
    },
  },
  {
    name: "get_pending_approvals",
    description: "Lấy danh sách yêu cầu đang chờ duyệt (cho quản lý).",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["leave", "overtime", "all"],
          description: "Loại yêu cầu cần xem",
        },
      },
      required: [],
    },
  },
  {
    name: "navigate_to",
    description: "Điều hướng người dùng đến trang trong hệ thống.",
    input_schema: {
      type: "object" as const,
      properties: {
        page: {
          type: "string",
          enum: [
            "dashboard",
            "attendance",
            "leave",
            "payroll",
            "employees",
            "settings",
            "ess",
          ],
          description: "Trang cần đến",
        },
      },
      required: ["page"],
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// HR COPILOT CLASS
// ═══════════════════════════════════════════════════════════════

export class HRCopilot {
  private client: Anthropic;
  private context: CopilotContext;

  constructor(context: CopilotContext) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    });
    this.context = context;
  }

  /**
   * Process a user message and return AI response
   */
  async chat(
    messages: CopilotMessage[],
    conversationId?: string,
  ): Promise<CopilotResponse> {
    const systemPrompt = this.buildSystemPrompt();

    try {
      // Initial call with tools
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        tools: HR_TOOLS,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      // Handle tool calls
      let finalResponse = response;
      const toolResults: Array<{ tool: string; result: unknown }> = [];

      while (finalResponse.stop_reason === "tool_use") {
        const toolUseBlocks = finalResponse.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );

        const toolResultMessages: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const result = await this.executeTool(
            toolUse.name,
            toolUse.input as Record<string, unknown>,
          );
          toolResults.push({ tool: toolUse.name, result });
          toolResultMessages.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        }

        // Continue conversation with tool results
        finalResponse = await this.client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: systemPrompt,
          tools: HR_TOOLS,
          messages: [
            ...messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            { role: "assistant" as const, content: finalResponse.content },
            { role: "user" as const, content: toolResultMessages },
          ],
        });
      }

      // Extract text response
      const textBlock = finalResponse.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      const responseText =
        textBlock?.text || "Xin lỗi, tôi không thể xử lý yêu cầu này.";

      // Parse actions from response
      const { message, actions } = this.parseActions(responseText);

      // Detect intent
      const intent = this.detectIntent(messages[messages.length - 1].content);

      // Generate suggestions
      const suggestions = this.generateSuggestions(intent, actions);

      // Save to conversation history
      if (conversationId) {
        await this.saveMessage(
          conversationId,
          messages[messages.length - 1].content,
          message,
          intent,
        );
      }

      return {
        message,
        intent,
        actions,
        suggestions,
      };
    } catch (error) {
      console.error("HR Copilot error:", error);
      throw error;
    }
  }

  /**
   * Build system prompt with user context
   */
  private buildSystemPrompt(): string {
    const parts: string[] = [];

    parts.push(`Bạn là HR Copilot - Trợ lý AI nhân sự thông minh của Lạc Việt HR.
Bạn có thể truy vấn dữ liệu và thực hiện các tác vụ nhân sự thông qua tools.

## Nguyên tắc:
1. Luôn trả lời bằng tiếng Việt, thân thiện và chuyên nghiệp
2. Sử dụng tools khi cần tra cứu dữ liệu hoặc thực hiện hành động
3. KHÔNG giả định hay bịa thông tin - luôn dùng tools để lấy dữ liệu thực
4. Giữ câu trả lời ngắn gọn, rõ ràng
5. Đề xuất hành động tiếp theo khi phù hợp

## Thông tin người dùng:
- Tên: ${this.context.employee?.name || "Người dùng"}
- Vai trò: ${this.context.role}`);

    if (this.context.employee) {
      parts.push(`- Mã NV: ${this.context.employee.code}
- Phòng ban: ${this.context.employee.department}
- Vị trí: ${this.context.employee.position}`);
    }

    if (this.context.leaveBalances && this.context.leaveBalances.length > 0) {
      parts.push("\n## Ngày phép còn lại:");
      for (const lb of this.context.leaveBalances) {
        parts.push(`- ${lb.type}: ${lb.available}/${lb.total} ngày`);
      }
    }

    if (this.context.pendingApprovals && this.context.pendingApprovals > 0) {
      parts.push(
        `\n## Thông báo: Có ${this.context.pendingApprovals} yêu cầu đang chờ duyệt.`,
      );
    }

    parts.push(`\n## Format hành động:
Khi cần thực hiện hành động UI, thêm block sau ở cuối:
[ACTION:type]{"params":"values"}[/ACTION]

VD: [ACTION:navigate]{"page":"leave","action":"create"}[/ACTION]`);

    return parts.join("\n");
  }

  /**
   * Execute a tool call
   */
  private async executeTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case "get_leave_balance":
        return this.getLeaveBalance(params.year as number);

      case "get_attendance_summary":
        return this.getAttendanceSummary(
          params.startDate as string,
          params.endDate as string,
        );

      case "search_knowledge":
        return this.searchKnowledge(params.query as string);

      case "create_leave_request":
        return this.createLeaveRequest(
          params as {
            leaveType: string;
            startDate: string;
            endDate: string;
            reason: string;
          },
        );

      case "get_pending_approvals":
        return this.getPendingApprovals(params.type as string);

      case "navigate_to":
        return this.navigateTo(params.page as string);

      default:
        return { error: "Tool not found" };
    }
  }

  /**
   * Get leave balance for employee
   */
  private async getLeaveBalance(year?: number): Promise<unknown> {
    if (!this.context.employeeId) {
      return { error: "Không tìm thấy thông tin nhân viên" };
    }

    const targetYear = year || new Date().getFullYear();

    const balances = await db.leaveBalance.findMany({
      where: {
        tenantId: this.context.tenantId,
        employeeId: this.context.employeeId,
        year: targetYear,
      },
      include: {
        policy: {
          select: { name: true, leaveType: true },
        },
      },
    });

    return balances.map((b) => ({
      type: b.policy.name,
      leaveType: b.policy.leaveType,
      entitlement: b.entitlement,
      used: b.used,
      pending: b.pending,
      available: b.available,
      carryOver: b.carryOver,
    }));
  }

  /**
   * Get attendance summary
   */
  private async getAttendanceSummary(
    startDate: string,
    endDate: string,
  ): Promise<unknown> {
    if (!this.context.employeeId) {
      return { error: "Không tìm thấy thông tin nhân viên" };
    }

    const attendances = await db.attendance.findMany({
      where: {
        tenantId: this.context.tenantId,
        employeeId: this.context.employeeId,
        date: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
    });

    const summary = {
      totalDays: attendances.length,
      present: attendances.filter((a) => a.status === "PRESENT").length,
      late: attendances.filter((a) =>
        ["LATE", "LATE_AND_EARLY"].includes(a.status),
      ).length,
      absent: attendances.filter((a) => a.status === "ABSENT").length,
      onLeave: attendances.filter((a) => a.status === "ON_LEAVE").length,
      totalWorkHours: attendances.reduce(
        (sum, a) => sum + Number(a.workHours || 0),
        0,
      ),
      totalOTHours: attendances.reduce(
        (sum, a) => sum + Number(a.otHours || 0),
        0,
      ),
      totalLateMinutes: attendances.reduce(
        (sum, a) => sum + Number(a.lateMinutes || 0),
        0,
      ),
    };

    return summary;
  }

  /**
   * Search knowledge base
   */
  private async searchKnowledge(query: string): Promise<unknown> {
    const articles = await db.knowledgeArticle.findMany({
      where: {
        tenantId: this.context.tenantId,
        isPublished: true,
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
          { keywords: { hasSome: query.toLowerCase().split(" ") } },
        ],
      },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
      },
      take: 3,
    });

    if (articles.length === 0) {
      return { message: "Không tìm thấy tài liệu liên quan." };
    }

    return articles.map((a) => ({
      title: a.title,
      category: a.category,
      content: a.content?.substring(0, 500) + "...",
    }));
  }

  /**
   * Create leave request (returns action, not actually creating)
   */
  private async createLeaveRequest(params: {
    leaveType: string;
    startDate: string;
    endDate: string;
    reason: string;
  }): Promise<unknown> {
    // Validate dates
    const start = new Date(params.startDate);
    const end = new Date(params.endDate);

    if (start > end) {
      return { error: "Ngày bắt đầu phải trước ngày kết thúc" };
    }

    if (start < new Date()) {
      return { error: "Không thể tạo đơn cho ngày đã qua" };
    }

    // Calculate days
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    return {
      action: "create_leave_request",
      params: {
        ...params,
        totalDays: diffDays,
      },
      message: `Đã chuẩn bị đơn xin nghỉ ${diffDays} ngày từ ${params.startDate} đến ${params.endDate}.`,
      requireConfirmation: true,
    };
  }

  /**
   * Get pending approvals
   */
  private async getPendingApprovals(type?: string): Promise<unknown> {
    const where: Record<string, unknown> = {
      instance: { tenantId: this.context.tenantId },
      approverId: this.context.userId,
      status: "PENDING",
    };

    if (type && type !== "all") {
      where.instance = {
        ...(where.instance as object),
        workflowType: type === "leave" ? "LEAVE_REQUEST" : "OVERTIME_REQUEST",
      };
    }

    const approvals = await db.approvalStep.findMany({
      where,
      include: {
        instance: {
          include: {
            requester: {
              select: { name: true },
            },
          },
        },
      },
      take: 10,
    });

    return {
      count: approvals.length,
      items: approvals.map((a) => ({
        id: a.id,
        type: a.instance.referenceType,
        requester: a.instance.requester.name,
        createdAt: a.createdAt,
      })),
    };
  }

  /**
   * Navigate to page
   */
  private navigateTo(page: string): unknown {
    const routes: Record<string, string> = {
      dashboard: "/dashboard",
      attendance: "/attendance",
      leave: "/leave",
      payroll: "/payroll",
      employees: "/employees",
      settings: "/settings",
      ess: "/ess",
    };

    return {
      action: "navigate",
      url: routes[page] || "/dashboard",
      message: `Đang chuyển đến trang ${page}...`,
    };
  }

  /**
   * Parse actions from response text
   */
  private parseActions(text: string): {
    message: string;
    actions: CopilotAction[];
  } {
    const actionRegex = /\[ACTION:(\w+)\]([^\[]*)\[\/ACTION\]/g;
    const actions: CopilotAction[] = [];
    let message = text;

    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      try {
        const actionType = match[1];
        const params = JSON.parse(match[2].trim());
        actions.push({
          type: actionType,
          params,
          label: this.getActionLabel(actionType),
        });
        message = message.replace(match[0], "");
      } catch {
        // Skip invalid actions
      }
    }

    return { message: message.trim(), actions };
  }

  /**
   * Get action label
   */
  private getActionLabel(actionType: string): string {
    const labels: Record<string, string> = {
      navigate: "Đi đến trang",
      create_leave_request: "Tạo đơn nghỉ phép",
      create_ot_request: "Tạo đơn tăng ca",
      view_payslip: "Xem phiếu lương",
      view_attendance: "Xem chấm công",
    };
    return labels[actionType] || actionType;
  }

  /**
   * Detect intent from message
   */
  private detectIntent(message: string): AIIntentType {
    const lowerMessage = message.toLowerCase();

    // FAQ patterns
    if (
      /chính sách|quy định|quy trình|thủ tục|làm sao|cách nào|hướng dẫn/.test(
        lowerMessage,
      )
    ) {
      return "FAQ";
    }

    // Data query patterns
    if (
      /còn bao nhiêu|số ngày|lương|ngày công|chấm công|thông tin/.test(
        lowerMessage,
      )
    ) {
      return "DATA_QUERY";
    }

    // Action patterns
    if (/tạo đơn|xin nghỉ|đăng ký|submit|gửi/.test(lowerMessage)) {
      return "ACTION_REQUEST";
    }

    // Report patterns
    if (/báo cáo|thống kê|tổng hợp|xuất|report/.test(lowerMessage)) {
      return "REPORT_REQUEST";
    }

    // General chat
    if (/chào|cảm ơn|thanks|hi|hello|bye/.test(lowerMessage)) {
      return "GENERAL_CHAT";
    }

    return "UNKNOWN";
  }

  /**
   * Generate follow-up suggestions
   */
  private generateSuggestions(
    intent: AIIntentType,
    actions: CopilotAction[],
  ): string[] {
    const suggestions: string[] = [];

    switch (intent) {
      case "DATA_QUERY":
        suggestions.push(
          "Xem chi tiết chấm công tháng này",
          "Tạo đơn xin nghỉ phép",
          "Xem phiếu lương gần nhất",
        );
        break;
      case "FAQ":
        suggestions.push(
          "Hỏi thêm về chính sách khác",
          "Xem danh sách quy định",
          "Liên hệ phòng nhân sự",
        );
        break;
      case "ACTION_REQUEST":
        if (actions.length === 0) {
          suggestions.push(
            "Tạo đơn xin nghỉ phép",
            "Đăng ký tăng ca",
            "Xem yêu cầu đang chờ",
          );
        }
        break;
      case "GENERAL_CHAT":
        suggestions.push(
          "Xem ngày phép còn lại",
          "Kiểm tra lương tháng này",
          "Hỏi về quy định công ty",
        );
        break;
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Save message to conversation history
   */
  private async saveMessage(
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
    intent: AIIntentType,
  ): Promise<void> {
    try {
      await db.aIMessage.createMany({
        data: [
          {
            conversationId,
            role: "user",
            content: userMessage,
          },
          {
            conversationId,
            role: "assistant",
            content: assistantMessage,
            intent,
          },
        ],
      });
    } catch (error) {
      console.error("Error saving message:", error);
    }
  }
}

/**
 * Create HR Copilot instance with user context
 */
export async function createHRCopilot(
  tenantId: string,
  userId: string,
): Promise<HRCopilot> {
  // Fetch user and employee context
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      employee: {
        include: {
          department: { select: { name: true } },
          position: { select: { name: true } },
        },
      },
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  // Fetch leave balances
  const leaveBalances = user.employeeId
    ? await db.leaveBalance.findMany({
        where: {
          tenantId,
          employeeId: user.employeeId,
          year: new Date().getFullYear(),
        },
        include: { policy: { select: { name: true } } },
      })
    : [];

  // Count pending approvals
  const pendingApprovals = await db.approvalStep.count({
    where: {
      instance: { tenantId },
      approverId: userId,
      status: "PENDING",
    },
  });

  const context: CopilotContext = {
    tenantId,
    userId,
    employeeId: user.employeeId || undefined,
    employee: user.employee
      ? {
          code: user.employee.employeeCode,
          name: user.employee.fullName,
          department: user.employee.department?.name || "N/A",
          position: user.employee.position?.name || "N/A",
          managerId: user.employee.directManagerId || undefined,
        }
      : undefined,
    role: user.role,
    leaveBalances: leaveBalances.map((lb) => ({
      type: lb.policy.name,
      available: Number(lb.available),
      total: Number(lb.entitlement) + Number(lb.carryOver),
    })),
    pendingApprovals,
  };

  return new HRCopilot(context);
}
