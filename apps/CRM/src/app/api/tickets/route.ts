import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, AuthError } from "@/lib/auth/get-current-user";
import { canAccess } from "@/lib/auth/rbac";
import { Unauthorized, handleApiError } from "@/lib/api/errors";
import { apiSuccess } from "@/lib/api/response";
import { validateRequest, ticketQuerySchema } from "@/lib/validations";
import { calculateSlaStatus } from "@/lib/tickets/sla-engine";
import { removeDiacritics } from "@/lib/utils/vietnamese";
import type { Prisma } from ".prisma/crm-client";

// GET /api/tickets — List tickets (MEMBER sees assigned, MANAGER+ sees all)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const params = validateRequest(
      ticketQuerySchema,
      Object.fromEntries(req.nextUrl.searchParams),
    );

    const where: Prisma.SupportTicketWhereInput = {};

    // RBAC: MEMBER sees only assigned tickets
    if (!canAccess(user, "view_all")) {
      where.assigneeId = user.id;
    }

    // Filters
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.assigneeId) where.assigneeId = params.assigneeId;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }
    if (params.q) {
      const normalized = removeDiacritics(params.q);
      const terms = [params.q];
      if (normalized !== params.q) terms.push(normalized);
      where.OR = terms.flatMap((term) => [
        { subject: { contains: term, mode: "insensitive" as const } },
        { ticketNumber: { contains: term, mode: "insensitive" as const } },
      ]);
    }

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: {
          portalUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          company: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    // Calculate SLA status for active tickets
    const activeStatuses = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"];
    const ticketsWithSla = await Promise.all(
      tickets.map(async (ticket) => {
        if (activeStatuses.includes(ticket.status)) {
          const sla = await calculateSlaStatus(ticket);
          // Return worst SLA status for list indicator
          const frStatus = sla.firstResponse.status;
          const resStatus = sla.resolution.status;
          const worstStatus =
            frStatus === "breached" || resStatus === "breached"
              ? "breached"
              : frStatus === "at_risk" || resStatus === "at_risk"
                ? "at_risk"
                : "on_track";
          return { ...ticket, slaStatus: worstStatus };
        }
        if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
          return {
            ...ticket,
            slaStatus: ticket.slaBreached ? "breached" : "met",
          };
        }
        return { ...ticket, slaStatus: null };
      }),
    );

    return apiSuccess({
      data: ticketsWithSla,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    });
  } catch (error) {
    if (error instanceof AuthError)
      return handleApiError(Unauthorized(error.message), "/api/tickets");
    return handleApiError(error, "/api/tickets");
  }
}
