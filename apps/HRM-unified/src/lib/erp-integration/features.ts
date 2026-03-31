// ============================================================
// HRM Feature Flags Integration
// Controls which HRM features are available per tier
// ============================================================

import { isFeatureEnabled, requireFeature, type FeatureFlagError } from '@vierp/feature-flags';
import type { Tier } from '@vierp/shared';

/**
 * HRM feature keys mapped to tier requirements
 */
export const HRM_FEATURES = {
  // Basic (Free)
  EMPLOYEE_MANAGEMENT: 'hrm-basic',
  ATTENDANCE_BASIC: 'hrm-basic',
  LEAVE_BASIC: 'hrm-basic',
  DEPARTMENT_MANAGEMENT: 'hrm-basic',

  // Pro ($)
  PAYROLL: 'hrm-advanced',
  RECRUITMENT: 'hrm-advanced',
  PERFORMANCE_REVIEW: 'hrm-advanced',
  KPI_MANAGEMENT: 'hrm-advanced',
  COMPENSATION: 'hrm-advanced',
  DOCUMENT_GENERATION: 'hrm-advanced',
  REPORTS_HUB: 'hrm-advanced',
  IMPORT_EXPORT: 'hrm-advanced',
  SHIFT_MANAGEMENT: 'hrm-advanced',
  OFFBOARDING: 'hrm-advanced',

  // Enterprise ($$)
  AI_COPILOT: 'ai-copilot',
  PREDICTIVE_ANALYTICS: 'ai-copilot',
  LMS_LEARNING: 'ai-copilot',
  ENGAGEMENT_SURVEYS: 'ai-copilot',
  SUCCESSION_PLANNING: 'ai-copilot',
  CUSTOM_WORKFLOWS: 'ai-copilot',
  ESIGNATURE: 'ai-copilot',
  ADVANCED_SECURITY: 'ai-copilot',
} as const;

/**
 * Check if a specific HRM feature is accessible for the user's tier
 */
export function checkFeatureAccess(
  featureKey: keyof typeof HRM_FEATURES,
  userTier: Tier
): { allowed: boolean; requiredTier?: string } {
  const flagKey = HRM_FEATURES[featureKey];
  const allowed = isFeatureEnabled(flagKey, userTier);

  if (!allowed) {
    return {
      allowed: false,
      requiredTier: flagKey === 'hrm-basic' ? 'basic'
        : flagKey === 'hrm-advanced' ? 'pro'
        : 'enterprise',
    };
  }

  return { allowed: true };
}

/**
 * Middleware helper — throws FeatureFlagError if feature not accessible
 */
export function requireHRMFeature(
  featureKey: keyof typeof HRM_FEATURES,
  userTier: Tier
): void {
  const flagKey = HRM_FEATURES[featureKey];
  requireFeature(flagKey, userTier);
}
