// ============================================================
// @vierp/ai-copilot — Context Builder
// Builds rich context from ERP data for AI conversations
// ============================================================

import type { ConversationContext, DataCard } from '../types';
import { customerService, productService, employeeService } from '@vierp/master-data';

/**
 * Build ERP context string for the AI model
 * Includes relevant master data summaries, recent activity, and KPIs
 */
export async function buildERPContext(context: ConversationContext): Promise<{
  contextString: string;
  dataCards: DataCard[];
}> {
  const parts: string[] = [];
  const dataCards: DataCard[] = [];

  try {
    // Customer stats
    const customerStats = await customerService.getStats(context.tenantId);
    parts.push(`Khách hàng: ${customerStats.total} (${customerStats.active} hoạt động)`);
    dataCards.push({
      title: 'Khách hàng',
      type: 'metric',
      data: customerStats,
      source: 'master-data',
    });
  } catch { /* DB not available */ }

  try {
    // Product stats
    const productStats = await productService.getStats(context.tenantId);
    parts.push(`Sản phẩm: ${productStats.total} (${productStats.active} hoạt động)`);
    dataCards.push({
      title: 'Sản phẩm',
      type: 'metric',
      data: productStats,
      source: 'master-data',
    });
  } catch { /* DB not available */ }

  try {
    // Employee stats
    const employeeStats = await employeeService.getStats(context.tenantId);
    parts.push(`Nhân viên: ${employeeStats.total} (${employeeStats.active} hoạt động)`);
    dataCards.push({
      title: 'Nhân viên',
      type: 'metric',
      data: employeeStats,
      source: 'master-data',
    });
  } catch { /* DB not available */ }

  // Tier-specific context
  switch (context.tier) {
    case 'enterprise':
      parts.push('Tier: Enterprise — Full IFRS, AI Copilot, Custom SDK');
      break;
    case 'pro':
      parts.push('Tier: Pro — VAS, MRP, OTB, TPM, Accounting');
      break;
    case 'basic':
      parts.push('Tier: Basic — HRM, CRM, PM, ExcelAI');
      break;
  }

  return {
    contextString: parts.join('\n'),
    dataCards,
  };
}

/**
 * Estimate token count for a string (rough approximation)
 * Vietnamese text uses ~1.5 tokens per character on average
 */
export function estimateTokens(text: string): number {
  // Vietnamese: ~1.5 tokens/char; English: ~0.75 tokens/word
  const hasVietnamese = /[\u00C0-\u1EF9]/.test(text);
  if (hasVietnamese) {
    return Math.ceil(text.length * 1.5);
  }
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

/**
 * Truncate context to fit within token budget
 */
export function truncateContext(context: string, maxTokens: number): string {
  const currentTokens = estimateTokens(context);
  if (currentTokens <= maxTokens) return context;

  // Truncate from the middle, keeping start and end
  const ratio = maxTokens / currentTokens;
  const keepChars = Math.floor(context.length * ratio);
  const half = Math.floor(keepChars / 2);

  return context.substring(0, half) + '\n...[truncated]...\n' + context.substring(context.length - half);
}

/**
 * Extract intent from user message for routing
 */
export function classifyIntent(message: string): {
  module: string;
  action: string;
  confidence: number;
} {
  const lower = message.toLowerCase();

  // Vietnamese intent patterns
  const patterns: Array<{ regex: RegExp; module: string; action: string }> = [
    // HRM
    { regex: /nhân viên|lương|nghỉ phép|chấm công|tuyển dụng|attendance|leave|payroll|employee/i, module: 'hrm', action: 'query' },
    // CRM
    { regex: /khách hàng|đơn hàng|customer|order|deal|quote|campaign/i, module: 'crm', action: 'query' },
    // MRP
    { regex: /sản xuất|kho|vật tư|nguyên liệu|production|inventory|material|bom/i, module: 'mrp', action: 'query' },
    // Accounting
    { regex: /kế toán|hóa đơn|thuế|công nợ|journal|invoice|tax|accounting|vat|gl/i, module: 'accounting', action: 'query' },
    // PM
    { regex: /dự án|project|task|sprint|gantt|milestone/i, module: 'pm', action: 'query' },
    // Reports
    { regex: /báo cáo|report|dashboard|thống kê|analysis|biểu đồ/i, module: 'general', action: 'report' },
    // Create
    { regex: /tạo|thêm|create|add|new/i, module: 'general', action: 'create' },
    // Help
    { regex: /giúp|hướng dẫn|help|how to|cách/i, module: 'general', action: 'help' },
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(lower)) {
      return { module: pattern.module, action: pattern.action, confidence: 0.85 };
    }
  }

  return { module: 'general', action: 'chat', confidence: 0.5 };
}
