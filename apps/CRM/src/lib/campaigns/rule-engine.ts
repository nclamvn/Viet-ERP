import { Prisma } from ".prisma/crm-client";
import { prisma } from "@/lib/prisma";
import type {
  AudienceRules,
  AudienceRule,
  AudienceRuleGroup,
} from "@/lib/audience-fields";
import type { ResolvedContact } from "./audience";

// ── Build Prisma WHERE from a single rule ───────────────────────────

function buildRuleWhere(rule: AudienceRule): Prisma.ContactWhereInput {
  const { field, operator, value } = rule;

  // Handle nested company fields
  if (field.startsWith("company.")) {
    const subfield = field.split(".")[1];
    const condition = buildOperatorCondition(operator, value, "string");
    return { company: { [subfield]: condition } };
  }

  // Handle tags relation
  if (field === "tags") {
    switch (operator) {
      case "in": {
        const names = Array.isArray(value)
          ? value
          : String(value)
              .split(",")
              .map((s) => s.trim());
        return {
          tags: { some: { tag: { name: { in: names, mode: "insensitive" } } } },
        };
      }
      case "not_in": {
        const names = Array.isArray(value)
          ? value
          : String(value)
              .split(",")
              .map((s) => s.trim());
        return {
          NOT: {
            tags: {
              some: { tag: { name: { in: names, mode: "insensitive" } } },
            },
          },
        };
      }
      case "is_empty":
        return { tags: { none: {} } };
      case "is_not_empty":
        return { tags: { some: {} } };
      default:
        return {};
    }
  }

  // Handle companyId is_empty/is_not_empty
  if (field === "companyId") {
    if (operator === "is_empty") return { companyId: null };
    if (operator === "is_not_empty") return { companyId: { not: null } };
  }

  // Determine field type for date coercion
  const isDateField = field === "lastActivityAt" || field === "createdAt";
  const fieldType = isDateField ? "date" : "auto";
  const condition = buildOperatorCondition(operator, value, fieldType);

  return { [field]: condition };
}

// ── Operator → Prisma condition ─────────────────────────────────────

function buildOperatorCondition(
  operator: string,
  value: any,
  fieldType: string,
): any {
  const coerce = (v: any) => {
    if (fieldType === "date" && v) return new Date(v);
    return v;
  };

  switch (operator) {
    case "equals":
      return { equals: coerce(value) };
    case "not_equals":
      return { not: coerce(value) };
    case "contains":
      return { contains: String(value), mode: "insensitive" as const };
    case "not_contains":
      return { not: { contains: String(value), mode: "insensitive" as const } };
    case "greater_than":
      return { gt: coerce(value) };
    case "less_than":
      return { lt: coerce(value) };
    case "in": {
      const arr = Array.isArray(value)
        ? value
        : String(value)
            .split(",")
            .map((s) => s.trim());
      return { in: arr.map(coerce) };
    }
    case "not_in": {
      const arr = Array.isArray(value)
        ? value
        : String(value)
            .split(",")
            .map((s) => s.trim());
      return { notIn: arr.map(coerce) };
    }
    case "is_empty":
      return null;
    case "is_not_empty":
      return { not: null };
    case "between": {
      const [from, to] = Array.isArray(value)
        ? value
        : [value?.from, value?.to];
      return { gte: coerce(from), lte: coerce(to) };
    }
    default:
      return { equals: value };
  }
}

// ── Build WHERE from group ──────────────────────────────────────────

function buildGroupWhere(group: AudienceRuleGroup): Prisma.ContactWhereInput {
  const conditions = group.rules.map(buildRuleWhere);
  if (conditions.length === 1) return conditions[0];

  return group.connector === "AND" ? { AND: conditions } : { OR: conditions };
}

// ── Build full WHERE from rules ─────────────────────────────────────

export function buildPrismaWhere(
  rules: AudienceRules,
): Prisma.ContactWhereInput {
  const groupConditions = rules.groups.map(buildGroupWhere);
  if (groupConditions.length === 1) return groupConditions[0];

  return rules.connector === "AND"
    ? { AND: groupConditions }
    : { OR: groupConditions };
}

// ── Resolve contacts by rules ───────────────────────────────────────

export async function resolveAudienceByRules(
  rules: AudienceRules,
): Promise<ResolvedContact[]> {
  const where = buildPrismaWhere(rules);

  const contacts = await prisma.contact.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      jobTitle: true,
      company: { select: { name: true } },
    },
  });

  // Filter unsubscribed
  const unsubscribed = await prisma.unsubscribe.findMany({
    select: { email: true },
  });
  const unsubscribedSet = new Set(
    unsubscribed.map((u) => u.email.toLowerCase()),
  );

  return contacts.filter((c): c is ResolvedContact => {
    if (!c.email) return false;
    if (unsubscribedSet.has(c.email.toLowerCase())) return false;
    return true;
  });
}

// ── Count contacts by rules (for preview) ───────────────────────────

export async function countAudienceByRules(
  rules: AudienceRules,
): Promise<number> {
  const where = buildPrismaWhere(rules);
  return prisma.contact.count({ where });
}
