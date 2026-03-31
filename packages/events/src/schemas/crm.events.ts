// ============================================================
// @vierp/events - CRM Event Schemas
// Sự kiện từ module CRM (Quản lý mối quan hệ khách hàng)
// ============================================================

import { z } from 'zod';

/**
 * LeadCreated - Tạo mới một lead
 * Kích hoạt: User tạo lead mới trong CRM
 */
export const LeadCreatedSchema = z.object({
  leadId: z.string().min(1),
  email: z.string().email(),
  phone: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  company: z.string().optional(),
  source: z.string(), // 'website', 'email', 'phone', etc.
  score: z.number().int().min(0).default(0),
});

export type LeadCreated = z.infer<typeof LeadCreatedSchema>;

/**
 * LeadScored - Lead được đánh giá/cập nhật điểm
 * Kích hoạt: Hệ thống tự động hoặc manual scoring
 */
export const LeadScoredSchema = z.object({
  leadId: z.string().min(1),
  score: z.number().int().min(0),
  previousScore: z.number().int().min(0),
  scoringCriteria: z.array(z.object({
    criterion: z.string(),
    points: z.number().int(),
  })),
});

export type LeadScored = z.infer<typeof LeadScoredSchema>;

/**
 * LeadConverted - Lead được chuyển đổi thành Opportunity/Contact
 * Kích hoạt: Người dùng chuyển lead sang stage tiếp theo
 */
export const LeadConvertedSchema = z.object({
  leadId: z.string().min(1),
  convertedToType: z.enum(['contact', 'opportunity']),
  contactId: z.string().optional(),
  opportunityId: z.string().optional(),
  dealAmount: z.number().positive().optional(),
});

export type LeadConverted = z.infer<typeof LeadConvertedSchema>;

/**
 * DealWon - Thương vụ được thắng/hoàn tất
 * Kích hoạt: Opportunity được đánh dấu là Won
 * Trigger: Tạo hóa đơn trong Accounting
 */
export const DealWonSchema = z.object({
  dealId: z.string().min(1),
  opportunityId: z.string().min(1),
  customerId: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string(),
  amount: z.number().positive(),
  currency: z.string().default('VND'),
  dealDescription: z.string().optional(),
  closedDate: z.string().datetime(),
  products: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
    lineTotal: z.number().positive(),
  })).optional(),
});

export type DealWon = z.infer<typeof DealWonSchema>;

/**
 * DealLost - Thương vụ bị mất/đóng không thành công
 * Kích hoạt: Opportunity được đánh dấu là Lost
 */
export const DealLostSchema = z.object({
  dealId: z.string().min(1),
  opportunityId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().positive(),
  lostReason: z.string(),
  competitorName: z.string().optional(),
  lostDate: z.string().datetime(),
});

export type DealLost = z.infer<typeof DealLostSchema>;

/**
 * Export all CRM event schemas
 */
export const CRMEventSchemas = {
  'crm.lead.created': LeadCreatedSchema,
  'crm.lead.scored': LeadScoredSchema,
  'crm.lead.converted': LeadConvertedSchema,
  'crm.deal.won': DealWonSchema,
  'crm.deal.lost': DealLostSchema,
} as const;
