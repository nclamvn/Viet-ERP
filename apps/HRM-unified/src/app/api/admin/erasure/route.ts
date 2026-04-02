// src/app/api/admin/erasure/route.ts
// GDPR Erasure Request API (P2-20)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createErasureRequest,
  listErasureRequests,
} from "@/services/erasure.service";
import { z } from "zod";
import type { ErasureStatus } from ".prisma/hrm-unified-client";

const createSchema = z.object({
  employeeId: z.string().min(1),
  reason: z.string().min(10, "Lý do phải có ít nhất 10 ký tự"),
  legalBasis: z.string().optional(),
  scopeFields: z.array(z.enum(["personal", "contact", "bank", "tax"])).min(1),
});

// GET - List erasure requests
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (
      !session?.user ||
      !["SUPER_ADMIN", "ADMIN"].includes(session.user.role)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as ErasureStatus | null;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

    const result = await listErasureRequests(session.user.tenantId, {
      status: status || undefined,
      page,
      pageSize,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("List erasure requests error:", error);
    return NextResponse.json({ error: "Lỗi server" }, { status: 500 });
  }
}

// POST - Create erasure request
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (
      !session?.user ||
      !["SUPER_ADMIN", "ADMIN", "HR_MANAGER"].includes(session.user.role)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const validated = createSchema.parse(body);

    const erasureRequest = await createErasureRequest({
      tenantId: session.user.tenantId,
      employeeId: validated.employeeId,
      requestedBy: session.user.id,
      reason: validated.reason,
      legalBasis: validated.legalBasis,
      scopeFields: validated.scopeFields,
    });

    return NextResponse.json(
      { success: true, data: erasureRequest },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dữ liệu không hợp lệ", details: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Create erasure request error:", error);
    return NextResponse.json({ error: "Lỗi server" }, { status: 500 });
  }
}
