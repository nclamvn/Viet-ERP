import { prisma } from "@/lib/prisma";
import type { Prisma } from ".prisma/mrp-client";

interface MatchResult {
  status: "matched" | "mismatch_pending_review";
  qtyVariance: number;
  qtyVariancePct: number;
  amtVariance: number | null;
  amtVariancePct: number | null;
}

export function calculateMatch(
  poQuantity: number,
  poTotalAmount: number,
  grnAcceptedQty: number,
  invoiceAmount?: number,
): MatchResult {
  // Quantity variance
  const qtyVariance = grnAcceptedQty - poQuantity;
  const qtyVariancePct =
    poQuantity > 0 ? Math.round((qtyVariance / poQuantity) * 10000) / 100 : 0;

  // Amount variance (only if invoice provided)
  let amtVariance: number | null = null;
  let amtVariancePct: number | null = null;

  if (invoiceAmount !== undefined && invoiceAmount !== null) {
    amtVariance = Math.round((invoiceAmount - poTotalAmount) * 100) / 100;
    amtVariancePct =
      poTotalAmount > 0
        ? Math.round((amtVariance / poTotalAmount) * 10000) / 100
        : 0;
  }

  // Strict matching: 0% tolerance
  const qtyMatches = qtyVariance === 0;
  const amtMatches =
    invoiceAmount === undefined || invoiceAmount === null || amtVariance === 0;

  const status: MatchResult["status"] =
    qtyMatches && amtMatches ? "matched" : "mismatch_pending_review";

  return { status, qtyVariance, qtyVariancePct, amtVariance, amtVariancePct };
}

/**
 * Create match record when GRN is created.
 * Can be called inside or outside a transaction.
 */
export async function createMatchFromGRN(
  purchaseOrderId: string,
  grnId: string,
  tx?: Prisma.TransactionClient,
) {
  const db = tx || prisma;

  const po = await db.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  if (!po) return null;

  const grn = await db.goodsReceiptNote.findUnique({
    where: { id: grnId },
    include: { items: true },
  });
  if (!grn) return null;

  const poQuantity = po.lines.reduce((sum, line) => sum + line.quantity, 0);
  const poTotalAmount = po.totalAmount || 0;
  const poUnitPrice = poQuantity > 0 ? poTotalAmount / poQuantity : 0;

  const grnQuantity = grn.items.reduce(
    (sum, item) => sum + item.quantityReceived,
    0,
  );
  const grnAcceptedQty = grn.items.reduce(
    (sum, item) => sum + item.quantityAccepted,
    0,
  );

  const matchResult = calculateMatch(poQuantity, poTotalAmount, grnAcceptedQty);

  return db.threeWayMatch.create({
    data: {
      purchaseOrderId,
      grnId,
      status: matchResult.status,
      poQuantity,
      poUnitPrice,
      poTotalAmount,
      grnQuantity,
      grnAcceptedQty,
      qtyVariance: matchResult.qtyVariance,
      qtyVariancePct: matchResult.qtyVariancePct,
    },
  });
}

/**
 * Update match when invoice is added.
 */
export async function updateMatchWithInvoice(
  matchId: string,
  invoiceNumber: string,
  invoiceAmount: number,
  invoiceDate: Date,
  purchaseInvoiceId?: string,
) {
  const match = await prisma.threeWayMatch.findUnique({
    where: { id: matchId },
  });
  if (!match) return null;

  const matchResult = calculateMatch(
    match.poQuantity,
    match.poTotalAmount,
    match.grnAcceptedQty || 0,
    invoiceAmount,
  );

  return prisma.threeWayMatch.update({
    where: { id: matchId },
    data: {
      invoiceNumber,
      invoiceAmount,
      invoiceDate,
      purchaseInvoiceId: purchaseInvoiceId || null,
      status: matchResult.status,
      amtVariance: matchResult.amtVariance,
      amtVariancePct: matchResult.amtVariancePct,
    },
  });
}
