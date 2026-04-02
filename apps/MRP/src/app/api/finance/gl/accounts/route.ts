// src/app/api/finance/gl/accounts/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withRoleAuth } from "@/lib/api/with-auth";
import { prisma } from "@/lib/prisma";
import { getAccountBalance, getTrialBalance } from "@/lib/finance";
import { logger } from "@/lib/logger";
import { AccountType } from ".prisma/mrp-client";
import {
  parsePaginationParams,
  buildOffsetPaginationQuery,
  buildPaginatedResponse,
  paginatedSuccess,
  paginatedError,
} from "@/lib/pagination";

const glAccountPostSchema = z.object({
  accountNumber: z.string().min(1, "Số tài khoản là bắt buộc"),
  name: z.string().min(1, "Tên tài khoản là bắt buộc"),
  description: z.string().optional(),
  accountType: z.string().min(1, "Loại tài khoản là bắt buộc"),
  accountCategory: z.string().min(1, "Danh mục tài khoản là bắt buộc"),
  parentId: z.string().optional(),
  normalBalance: z.enum(["DEBIT", "CREDIT"]).optional().default("DEBIT"),
  currencyCode: z.string().optional().default("USD"),
});

import {
  checkReadEndpointLimit,
  checkWriteEndpointLimit,
} from "@/lib/rate-limit";
// GET - Get GL accounts
export const GET = withRoleAuth(
  ["admin", "manager"],
  async (request, context, session) => {
    // Rate limiting
    const rateLimitResult = await checkReadEndpointLimit(request);
    if (rateLimitResult) return rateLimitResult;

    try {
      // Role-based access control: Finance routes require ADMIN or MANAGER

      const { searchParams } = new URL(request.url);
      const action = searchParams.get("action");
      const accountId = searchParams.get("id");
      const accountType = searchParams.get("type");

      // Get trial balance
      if (action === "trial-balance") {
        const asOfDate = searchParams.get("asOfDate");
        const trialBalance = await getTrialBalance(
          asOfDate ? new Date(asOfDate) : undefined,
        );
        return NextResponse.json({ trialBalance });
      }

      // Get account balance
      if (action === "balance" && accountId) {
        const asOfDate = searchParams.get("asOfDate");
        const balance = await getAccountBalance(
          accountId,
          asOfDate ? new Date(asOfDate) : undefined,
        );
        return NextResponse.json(balance);
      }

      // Get single account
      if (accountId) {
        const account = await prisma.gLAccount.findUnique({
          where: { id: accountId },
          include: {
            parent: true,
            children: true,
          },
        });

        if (!account) {
          return NextResponse.json(
            { error: "Account not found" },
            { status: 404 },
          );
        }

        return NextResponse.json(account);
      }

      // Build where clause
      const where: Record<string, unknown> = { isActive: true };
      if (accountType) where.accountType = accountType;

      const params = parsePaginationParams(request);
      const startTime = Date.now();

      // Get total count and paginated data in parallel
      const [totalCount, accounts] = await Promise.all([
        prisma.gLAccount.count({ where }),
        prisma.gLAccount.findMany({
          where,
          ...buildOffsetPaginationQuery(params),
          orderBy: params.sortBy
            ? { [params.sortBy]: params.sortOrder }
            : { accountNumber: "asc" },
        }),
      ]);

      return paginatedSuccess(
        buildPaginatedResponse(accounts, totalCount, params, startTime),
      );
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "GET /api/finance/gl/accounts" },
      );
      return paginatedError("Failed to get accounts", 500);
    }
  },
);

// POST - Create GL account
export const POST = withRoleAuth(
  ["admin", "manager"],
  async (request, context, session) => {
    // Rate limiting
    const rateLimitResult = await checkWriteEndpointLimit(request);
    if (rateLimitResult) return rateLimitResult;

    try {
      // Role-based access control: Finance routes require ADMIN or MANAGER

      const body = await request.json();
      const parsed = glAccountPostSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: "Dữ liệu không hợp lệ",
            errors: parsed.error.issues,
          },
          { status: 400 },
        );
      }
      const {
        accountNumber,
        name,
        description,
        accountType,
        accountCategory,
        parentId,
        normalBalance,
        currencyCode,
      } = parsed.data;

      // Check for duplicate account number
      const existing = await prisma.gLAccount.findUnique({
        where: { accountNumber },
      });

      if (existing) {
        return NextResponse.json(
          { error: "Account number already exists" },
          { status: 400 },
        );
      }

      const account = await prisma.gLAccount.create({
        data: {
          accountNumber,
          name,
          description,
          accountType: accountType as AccountType,
          accountCategory,
          parentId,
          normalBalance: normalBalance || "DEBIT",
          currencyCode: currencyCode || "USD",
        },
      });

      return NextResponse.json({
        success: true,
        accountId: account.id,
      });
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "POST /api/finance/gl/accounts" },
      );
      return NextResponse.json(
        { error: "Failed to create account" },
        { status: 500 },
      );
    }
  },
);

// PUT - Update GL account
export const PUT = withRoleAuth(
  ["admin", "manager"],
  async (request, context, session) => {
    // Rate limiting
    const rateLimitResult = await checkWriteEndpointLimit(request);
    if (rateLimitResult) return rateLimitResult;

    try {
      // Role-based access control: Finance routes require ADMIN or MANAGER

      const body = await request.json();
      const { accountId, ...updateData } = body;

      if (!accountId) {
        return NextResponse.json(
          { error: "accountId is required" },
          { status: 400 },
        );
      }

      const account = await prisma.gLAccount.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        return NextResponse.json(
          { error: "Account not found" },
          { status: 404 },
        );
      }

      if (account.isSystemAccount) {
        return NextResponse.json(
          { error: "Cannot modify system account" },
          { status: 400 },
        );
      }

      await prisma.gLAccount.update({
        where: { id: accountId },
        data: updateData,
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "PUT /api/finance/gl/accounts" },
      );
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }
  },
);

// DELETE - Deactivate GL account
export const DELETE = withRoleAuth(
  ["admin", "manager"],
  async (request, context, session) => {
    // Rate limiting
    const rateLimitResult = await checkWriteEndpointLimit(request);
    if (rateLimitResult) return rateLimitResult;

    try {
      // Role-based access control: Finance routes require ADMIN or MANAGER

      const { searchParams } = new URL(request.url);
      const accountId = searchParams.get("id");

      if (!accountId) {
        return NextResponse.json(
          { error: "accountId is required" },
          { status: 400 },
        );
      }

      const account = await prisma.gLAccount.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        return NextResponse.json(
          { error: "Account not found" },
          { status: 404 },
        );
      }

      if (account.isSystemAccount) {
        return NextResponse.json(
          { error: "Cannot delete system account" },
          { status: 400 },
        );
      }

      // Check for journal entries
      const entriesCount = await prisma.journalLine.count({
        where: { accountId },
      });

      if (entriesCount > 0) {
        // Deactivate instead of delete
        await prisma.gLAccount.update({
          where: { id: accountId },
          data: { isActive: false },
        });
        return NextResponse.json({
          success: true,
          message: "Account deactivated (has journal entries)",
        });
      }

      await prisma.gLAccount.delete({
        where: { id: accountId },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "DELETE /api/finance/gl/accounts" },
      );
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }
  },
);
