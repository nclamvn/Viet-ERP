import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/mrp-client";

interface AppliedRule {
  ruleId: string;
  ruleName: string;
  type: string;
  discountType: string;
  discountValue: number;
  discountAmount: number;
}

export interface PriceCalculationResult {
  partId: string;
  partNumber: string;
  partName: string;
  basePrice: number;
  finalPrice: number;
  quantity: number;
  totalDiscount: number;
  lineTotal: number;
  appliedRules: AppliedRule[];
}

export async function calculatePrice(
  partId: string,
  customerId?: string,
  quantity: number = 1,
  date: Date = new Date(),
): Promise<PriceCalculationResult> {
  // 1. Get part with base price
  const part = await prisma.part.findUnique({
    where: { id: partId },
    select: {
      id: true,
      partNumber: true,
      name: true,
      unitCost: true,
      category: true,
    },
  });

  if (!part) {
    throw new Error("Sản phẩm không tồn tại");
  }

  const basePrice = part.unitCost || 0;

  // 2. Build query for applicable rules
  const orConditions: Prisma.PricingRuleWhereInput[] = [];

  // Customer-specific rules
  if (customerId) {
    orConditions.push(
      { type: "customer_specific", customerId, partId },
      { type: "customer_specific", customerId, partId: null },
    );
  }

  // Quantity break rules
  orConditions.push({
    type: "quantity_break",
    partId,
    minQuantity: { lte: quantity },
    OR: [{ maxQuantity: { gte: quantity } }, { maxQuantity: null }],
  });

  // Date-based rules
  orConditions.push({
    type: "date_based",
    partId,
    validFrom: { lte: date },
    validTo: { gte: date },
  });

  // Category discount rules
  if (part.category) {
    orConditions.push({
      type: "category_discount",
      category: part.category,
    });
  }

  const rules = await prisma.pricingRule.findMany({
    where: {
      isActive: true,
      OR: orConditions,
    },
    orderBy: { priority: "desc" },
  });

  // 3. Apply rules in priority order
  let currentPrice = basePrice;
  const appliedRules: AppliedRule[] = [];

  for (const rule of rules) {
    let discountAmount = 0;

    switch (rule.discountType) {
      case "percent":
        discountAmount = currentPrice * (rule.discountValue / 100);
        currentPrice = currentPrice - discountAmount;
        break;
      case "fixed_amount":
        discountAmount = Math.min(rule.discountValue, currentPrice);
        currentPrice = currentPrice - discountAmount;
        break;
      case "fixed_price":
        discountAmount = currentPrice - rule.discountValue;
        currentPrice = rule.discountValue;
        break;
    }

    currentPrice = Math.max(0, currentPrice);

    appliedRules.push({
      ruleId: rule.id,
      ruleName: rule.name,
      type: rule.type,
      discountType: rule.discountType,
      discountValue: rule.discountValue,
      discountAmount: Math.round(discountAmount * 100) / 100,
    });

    // For fixed_price, stop applying more rules
    if (rule.discountType === "fixed_price") {
      break;
    }
  }

  const finalPrice = Math.round(currentPrice * 100) / 100;
  const totalDiscount = Math.round((basePrice - finalPrice) * 100) / 100;

  return {
    partId: part.id,
    partNumber: part.partNumber,
    partName: part.name,
    basePrice,
    finalPrice,
    quantity,
    totalDiscount,
    lineTotal: Math.round(finalPrice * quantity * 100) / 100,
    appliedRules,
  };
}
