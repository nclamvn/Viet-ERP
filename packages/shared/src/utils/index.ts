// ============================================================
// @vierp/shared - Utility Functions
// ============================================================

import type { ApiResponse, ApiError, PaginationMeta, EventEnvelope, Tier } from '../types';

// ==================== API Response Helpers ====================

export function successResponse<T>(data: T, meta?: PaginationMeta): ApiResponse<T> {
  return { success: true, data, meta };
}

export function errorResponse(code: string, message: string, details?: Record<string, string[]>): ApiResponse<never> {
  return { success: false, error: { code, message, details } };
}

export function paginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

// ==================== Event Helpers ====================

export function createEvent<T>(
  type: string,
  source: string,
  data: T,
  context: { tenantId: string; userId: string }
): EventEnvelope<T> {
  return {
    id: generateId(),
    type,
    source,
    timestamp: new Date().toISOString(),
    tenantId: context.tenantId,
    userId: context.userId,
    data,
  };
}

// ==================== ID Generation ====================

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

export function generateCode(prefix: string, sequence: number, padLength = 6): string {
  return `${prefix}-${String(sequence).padStart(padLength, '0')}`;
}

// ==================== Tier Helpers ====================

export function isTierAllowed(requiredTiers: Tier[], userTier: Tier): boolean {
  return requiredTiers.includes(userTier);
}

export function getTierLevel(tier: Tier): number {
  const levels: Record<Tier, number> = { basic: 0, pro: 1, enterprise: 2 };
  return levels[tier];
}

export function isAtLeastTier(userTier: Tier, requiredTier: Tier): boolean {
  return getTierLevel(userTier) >= getTierLevel(requiredTier);
}

// ==================== Formatting ====================

export function formatCurrency(amount: number, currency = 'VND', locale = 'vi-VN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

export function formatDate(date: Date | string, locale = 'vi-VN'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function formatNumber(num: number, locale = 'vi-VN'): string {
  return new Intl.NumberFormat(locale).format(num);
}

// ==================== Validation ====================

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidTaxCode(taxCode: string): boolean {
  // Vietnam tax code: 10 or 13 digits
  return /^\d{10}(\d{3})?$/.test(taxCode);
}

export function isValidPhone(phone: string): boolean {
  // Vietnam phone: starts with 0, 10-11 digits
  return /^0\d{9,10}$/.test(phone);
}

// ==================== String Helpers ====================

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function truncate(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - suffix.length) + suffix;
}
