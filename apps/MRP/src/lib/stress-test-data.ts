import { prisma } from "@/lib/prisma";
import { Supplier, Part, Customer } from ".prisma/mrp-client";

// Constants for generation
const CATEGORIES = [
  "electronics",
  "mechanical",
  "consumable",
  "packaging",
  "raw_material",
];
const UNITS = ["pcs", "kg", "m", "l", "set", "box"];
const COUNTRIES = [
  "Việt Nam",
  "USA",
  "China",
  "Japan",
  "Germany",
  "Korea",
  "Taiwan",
  "Singapore",
];
const PREFIXES = {
  supplier: "SUP",
  part: "PART",
  customer: "CUST",
};

// Helper for random number
const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
// Helper for random array item
const randomItem = <T>(arr: T[]): T => arr[randomInt(0, arr.length - 1)];

// Generators
const generateCode = (prefix: string, index: number) =>
  `${prefix}-${String(index).padStart(5, "0")}`;

export async function generateSuppliers(count: number): Promise<number> {
  const existingCount = await prisma.supplier.count();
  const suppliers = [];

  for (let i = 0; i < count; i++) {
    const idx = existingCount + i + 1;
    suppliers.push({
      code: generateCode(PREFIXES.supplier, idx),
      name: `Supplier ${generateCode("TEST", idx)}`, // Simple unique name
      category: randomItem(CATEGORIES),
      country: randomItem(COUNTRIES),
      contactName: `Contact ${idx}`,
      contactEmail: `contact${idx}@example.com`,
      contactPhone: `090${randomInt(1000000, 9999999)}`,
      paymentTerms: randomItem(["Net 30", "Net 60", "COD"]),
      status: "active",
      leadTimeDays: randomInt(1, 60),
      rating: randomInt(1, 5),
    });
  }

  // Use createMany for performance
  const result = await prisma.supplier.createMany({
    data: suppliers,
    skipDuplicates: true,
  });

  return result.count;
}

export async function generateParts(count: number): Promise<number> {
  const existingCount = await prisma.part.count();
  const created = 0;

  // Prisma createMany doesn't support nested writes (like cost, planning), so we might need a transaction
  // or just loop create for simplicity and correctness with relations, or createMany parts then createMany costs.
  // For 500 items, loop or small batches is fine, but createMany for base table + createMany for relations is faster.

  const partsData = [];
  const costData = [];
  const planningData = [];
  const complianceData = [];

  for (let i = 0; i < count; i++) {
    const idx = existingCount + i + 1;
    // Simple random ID generator to avoid crypto dependencies
    const partId =
      "part_" +
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);

    partsData.push({
      id: partId,
      partNumber: generateCode(PREFIXES.part, idx),
      name: `Part ${generateCode("TEST", idx)}`,
      category: randomItem(CATEGORIES),
      unit: randomItem(UNITS),
      status: "active",
      description: `Auto-generated part for stress testing. Index ${idx}`,
    });

    costData.push({
      partId,
      unitCost: randomInt(1, 1000) + randomInt(0, 99) / 100,
      // currency: 'USD', // Removed: Not in PartCost model
    });

    planningData.push({
      partId,
      minStockLevel: randomInt(10, 50),
      maxStock: randomInt(100, 500),
      reorderPoint: randomInt(20, 60),
      leadTimeDays: randomInt(5, 45),
    });

    complianceData.push({
      partId,
      rohsCompliant: Math.random() > 0.1,
      reachCompliant: Math.random() > 0.1,
    });
  }

  // Transaction for integrity
  await prisma.$transaction([
    prisma.part.createMany({ data: partsData, skipDuplicates: true }),
    prisma.partCost.createMany({ data: costData, skipDuplicates: true }),
    prisma.partPlanning.createMany({
      data: planningData,
      skipDuplicates: true,
    }),
    prisma.partCompliance.createMany({
      data: complianceData,
      skipDuplicates: true,
    }),
  ]);

  return partsData.length;
}

export async function generateCustomers(count: number): Promise<number> {
  const existingCount = await prisma.customer.count();
  const customers = [];

  for (let i = 0; i < count; i++) {
    const idx = existingCount + i + 1;
    customers.push({
      code: generateCode(PREFIXES.customer, idx),
      name: `Customer ${generateCode("TEST", idx)}`,
      type: randomItem(["Enterprise", "SMB", "Government", "Retail"]),
      country: randomItem(COUNTRIES),
      contactName: `Customer Contact ${idx}`,
      contactEmail: `cust${idx}@example.com`,
      contactPhone: `091${randomInt(1000000, 9999999)}`,
      paymentTerms: randomItem(["Net 30", "Net 45", "Prepaid"]),
      creditLimit: randomInt(10, 1000) * 1000,
      status: "active",
      billingAddress: `${randomInt(1, 999)} Test St, City ${randomInt(1, 10)}`,
    });
  }

  const result = await prisma.customer.createMany({
    data: customers,
    skipDuplicates: true,
  });

  return result.count;
}
