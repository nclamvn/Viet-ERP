// =============================================================================
// EMAIL PARSER HELPERS
// Shared entity lookup functions for email-to-order creation
// =============================================================================

import { prisma } from "@/lib/prisma";
import type { Customer, Supplier, Product, Part } from ".prisma/mrp-client";

// =============================================================================
// TYPES
// =============================================================================

export class EntityNotFoundError extends Error {
  constructor(
    message: string,
    public readonly entityType: "customer" | "supplier",
    public readonly entityName?: string,
  ) {
    super(message);
    this.name = "EntityNotFoundError";
  }
}

export interface OrderLineItem {
  partNumber: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
}

// =============================================================================
// ENTITY LOOKUP FUNCTIONS
// =============================================================================

/**
 * Find a customer by code or name (case-insensitive).
 * Throws EntityNotFoundError if not found.
 */
export async function findCustomerOrFail(
  code?: string,
  name?: string,
): Promise<Customer> {
  const conditions = [];
  if (code) conditions.push({ code });
  if (name)
    conditions.push({ name: { contains: name, mode: "insensitive" as const } });

  if (conditions.length === 0) {
    throw new EntityNotFoundError(
      "Customer not found. Please create customer first.",
      "customer",
    );
  }

  const customer = await prisma.customer.findFirst({
    where: { OR: conditions },
  });

  if (!customer) {
    throw new EntityNotFoundError(
      "Customer not found. Please create customer first.",
      "customer",
      name,
    );
  }

  return customer;
}

/**
 * Find a supplier by code or name (case-insensitive).
 * Throws EntityNotFoundError if not found.
 */
export async function findSupplierOrFail(
  code?: string,
  name?: string,
): Promise<Supplier> {
  const conditions = [];
  if (code) conditions.push({ code });
  if (name)
    conditions.push({ name: { contains: name, mode: "insensitive" as const } });

  if (conditions.length === 0) {
    throw new EntityNotFoundError(
      "Supplier not found. Please create supplier first.",
      "supplier",
    );
  }

  const supplier = await prisma.supplier.findFirst({
    where: { OR: conditions },
  });

  if (!supplier) {
    throw new EntityNotFoundError(
      "Supplier not found. Please create supplier first.",
      "supplier",
      name,
    );
  }

  return supplier;
}

/**
 * Batch-resolve order line items to product IDs.
 * Returns a Map from partNumber to product ID for all matched items.
 */
export async function resolveProductIds(
  items: OrderLineItem[],
): Promise<Map<string, string>> {
  const partNumbers = items
    .map((item) => item.partNumber)
    .filter(Boolean) as string[];
  const descriptions = items
    .map((item) => item.description)
    .filter(Boolean) as string[];

  if (partNumbers.length === 0 && descriptions.length === 0) {
    return new Map();
  }

  const orConditions = [];
  if (partNumbers.length > 0) {
    orConditions.push({ sku: { in: partNumbers } });
  }
  for (const desc of descriptions) {
    orConditions.push({
      name: { contains: desc, mode: "insensitive" as const },
    });
  }

  const allProducts = await prisma.product.findMany({
    where: { OR: orConditions },
  });

  const productBySkuMap = new Map<string, Product>(
    allProducts.filter((p) => p.sku).map((p) => [p.sku, p]),
  );

  const productIds = new Map<string, string>();
  for (const item of items) {
    if (item.partNumber) {
      const product =
        productBySkuMap.get(item.partNumber) ||
        allProducts.find((p) =>
          p.name.toLowerCase().includes((item.description || "").toLowerCase()),
        );
      if (product) {
        productIds.set(item.partNumber, product.id);
      }
    }
  }

  return productIds;
}

/**
 * Batch-resolve order line items to part IDs.
 * Returns a Map from partNumber to part ID for all matched items.
 */
export async function resolvePartIds(
  items: OrderLineItem[],
): Promise<Map<string, string>> {
  const partNumbers = items
    .map((item) => item.partNumber)
    .filter(Boolean) as string[];

  if (partNumbers.length === 0) {
    return new Map();
  }

  const allParts = await prisma.part.findMany({
    where: { partNumber: { in: partNumbers } },
  });

  const partByNumberMap = new Map<string, Part>(
    allParts.map((p) => [p.partNumber, p]),
  );

  const partIds = new Map<string, string>();
  for (const item of items) {
    if (item.partNumber) {
      const part = partByNumberMap.get(item.partNumber);
      if (part) {
        partIds.set(item.partNumber, part.id);
      }
    }
  }

  return partIds;
}
