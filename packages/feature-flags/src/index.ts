// ============================================================
// @vierp/feature-flags - Tier-Based Feature Flags System
// Controls module access based on Basic/Pro/Enterprise tiers
//
// Usage:
//   import { isFeatureEnabled, requireTier } from '@vierp/feature-flags';
//   if (isFeatureEnabled('mrp', userTier)) { ... }
//   requireTier('enterprise', userTier); // throws if insufficient
// ============================================================

import type { Tier } from '@vierp/shared';
import { MODULE_TIERS } from '@vierp/shared';

// ==================== Feature Registry ====================

/**
 * Extended feature definitions with metadata
 */
interface FeatureDefinition {
  key: string;
  name: string;
  description: string;
  enabledTiers: Tier[];
  module?: string;
  isEnabled: boolean;
}

const FEATURES: Map<string, FeatureDefinition> = new Map([
  // ===== Basic (Free) =====
  ['hrm-basic', {
    key: 'hrm-basic', name: 'HRM Cơ bản', module: 'HRM',
    description: 'Quản lý nhân sự, chấm công, nghỉ phép cơ bản',
    enabledTiers: ['basic', 'pro', 'enterprise'], isEnabled: true,
  }],
  ['crm-basic', {
    key: 'crm-basic', name: 'CRM Cơ bản', module: 'CRM',
    description: 'Quản lý khách hàng, liên hệ, pipeline bán hàng',
    enabledTiers: ['basic', 'pro', 'enterprise'], isEnabled: true,
  }],
  ['pm', {
    key: 'pm', name: 'Project Management', module: 'PM',
    description: 'Quản lý dự án, tác vụ, Gantt chart',
    enabledTiers: ['basic', 'pro', 'enterprise'], isEnabled: true,
  }],
  ['excel-ai', {
    key: 'excel-ai', name: 'ExcelAI', module: 'ExcelAI',
    description: 'Xử lý Excel/CSV với AI, offline-first PWA',
    enabledTiers: ['basic', 'pro', 'enterprise'], isEnabled: true,
  }],

  // ===== Pro ($) =====
  ['mrp', {
    key: 'mrp', name: 'MRP Đầy đủ', module: 'MRP',
    description: 'Quản lý sản xuất, BOM, tồn kho, chất lượng, OEE',
    enabledTiers: ['pro', 'enterprise'], isEnabled: true,
  }],
  ['otb', {
    key: 'otb', name: 'Order-to-Bill', module: 'OTB',
    description: 'Đơn hàng → Hóa đơn, quản lý thanh toán',
    enabledTiers: ['pro', 'enterprise'], isEnabled: true,
  }],
  ['accounting-vas', {
    key: 'accounting-vas', name: 'Kế toán VAS', module: 'ACC',
    description: 'Kế toán Việt Nam (TT200/TT133), e-Invoice, e-Tax',
    enabledTiers: ['pro', 'enterprise'], isEnabled: true,
  }],
  ['tpm', {
    key: 'tpm', name: 'Trade Promotion', module: 'TPM',
    description: 'Quản lý khuyến mại thương mại, claims, ngân sách',
    enabledTiers: ['pro', 'enterprise'], isEnabled: true,
  }],
  ['hrm-advanced', {
    key: 'hrm-advanced', name: 'HRM Nâng cao', module: 'HRM',
    description: 'Tính lương, tạo tài liệu, AI recommendations',
    enabledTiers: ['pro', 'enterprise'], isEnabled: true,
  }],
  ['crm-advanced', {
    key: 'crm-advanced', name: 'CRM Nâng cao', module: 'CRM',
    description: 'Phân khúc KH, email automation, rich analytics',
    enabledTiers: ['pro', 'enterprise'], isEnabled: true,
  }],

  // ===== Enterprise ($$) =====
  ['ai-copilot', {
    key: 'ai-copilot', name: 'AI Copilot', module: 'AI',
    description: 'NLP query, predictive analytics, smart automation',
    enabledTiers: ['enterprise'], isEnabled: true,
  }],
  ['accounting-ifrs', {
    key: 'accounting-ifrs', name: 'Kế toán IFRS', module: 'ACC',
    description: 'Báo cáo song song VAS + IFRS cho DN FDI/niêm yết',
    enabledTiers: ['enterprise'], isEnabled: true,
  }],
  ['ecommerce', {
    key: 'ecommerce', name: 'E-Commerce', module: 'ECOM',
    description: 'Shopee/Lazada/TikTok Shop integration, omnichannel',
    enabledTiers: ['enterprise'], isEnabled: true,
  }],
  ['custom-sdk', {
    key: 'custom-sdk', name: 'Custom SDK', module: 'SDK',
    description: 'GraphQL API, TypeScript/Python SDK, webhooks',
    enabledTiers: ['enterprise'], isEnabled: true,
  }],
  ['multi-tenant', {
    key: 'multi-tenant', name: 'Multi-Tenant', module: 'INFRA',
    description: 'Schema isolation, tenant management, billing',
    enabledTiers: ['enterprise'], isEnabled: true,
  }],
]);

// ==================== Core API ====================

const TIER_LEVELS: Record<Tier, number> = { basic: 0, pro: 1, enterprise: 2 };

/**
 * Check if a feature is enabled for a given tier
 */
export function isFeatureEnabled(featureKey: string, userTier: Tier): boolean {
  const feature = FEATURES.get(featureKey);
  if (!feature) return false;
  if (!feature.isEnabled) return false;
  return feature.enabledTiers.includes(userTier);
}

/**
 * Require minimum tier — throws if insufficient
 */
export function requireTier(requiredTier: Tier, userTier: Tier): void {
  if (TIER_LEVELS[userTier] < TIER_LEVELS[requiredTier]) {
    throw new FeatureFlagError(
      `Tính năng yêu cầu gói ${requiredTier.toUpperCase()}. Gói hiện tại: ${userTier.toUpperCase()}. Vui lòng nâng cấp.`,
      requiredTier,
      userTier
    );
  }
}

/**
 * Require a specific feature — throws if not enabled
 */
export function requireFeature(featureKey: string, userTier: Tier): void {
  if (!isFeatureEnabled(featureKey, userTier)) {
    const feature = FEATURES.get(featureKey);
    const requiredTier = feature?.enabledTiers[0] || 'enterprise';
    throw new FeatureFlagError(
      `Tính năng "${feature?.name || featureKey}" yêu cầu gói ${requiredTier.toUpperCase()}.`,
      requiredTier as Tier,
      userTier
    );
  }
}

/**
 * Get all features available for a tier
 */
export function getFeaturesForTier(tier: Tier): FeatureDefinition[] {
  return Array.from(FEATURES.values())
    .filter(f => f.isEnabled && f.enabledTiers.includes(tier));
}

/**
 * Get all features grouped by tier
 */
export function getFeaturesByTier(): Record<string, FeatureDefinition[]> {
  return {
    basic: Array.from(FEATURES.values()).filter(f => f.enabledTiers.includes('basic')),
    pro: Array.from(FEATURES.values()).filter(f => f.enabledTiers.includes('pro') && !f.enabledTiers.includes('basic')),
    enterprise: Array.from(FEATURES.values()).filter(f => f.enabledTiers[0] === 'enterprise'),
  };
}

/**
 * Check if a module is accessible for a given tier
 */
export function isModuleAccessible(moduleName: string, userTier: Tier): boolean {
  const moduleFeatures = Array.from(FEATURES.values())
    .filter(f => f.module === moduleName);
  return moduleFeatures.some(f => f.isEnabled && f.enabledTiers.includes(userTier));
}

// ==================== Error Class ====================

export class FeatureFlagError extends Error {
  public requiredTier: Tier;
  public currentTier: Tier;
  public code = 'INSUFFICIENT_TIER' as const;
  public status = 403;

  constructor(message: string, requiredTier: Tier, currentTier: Tier) {
    super(message);
    this.name = 'FeatureFlagError';
    this.requiredTier = requiredTier;
    this.currentTier = currentTier;
  }
}

// ==================== Next.js Middleware Helper ====================

/**
 * Create a Next.js middleware that checks feature flags
 * Usage: export default withFeatureFlag('mrp');
 */
export function createFeatureGuard(featureKey: string) {
  return (userTier: Tier): { allowed: boolean; error?: string; upgradeUrl?: string } => {
    if (isFeatureEnabled(featureKey, userTier)) {
      return { allowed: true };
    }
    const feature = FEATURES.get(featureKey);
    return {
      allowed: false,
      error: `Tính năng "${feature?.name}" yêu cầu nâng cấp gói.`,
      upgradeUrl: '/settings/billing?upgrade=true',
    };
  };
}
