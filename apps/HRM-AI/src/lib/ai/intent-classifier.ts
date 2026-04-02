// src/lib/ai/intent-classifier.ts
// Quick intent detection for routing

import { classify } from "./client";
import { INTENT_CLASSIFIER_PROMPT } from "./prompts";
import type { AIIntentType } from ".prisma/hrm-ai-client";

// Intent patterns for quick local classification
const INTENT_PATTERNS: Record<AIIntentType, RegExp[]> = {
  FAQ: [
    /chính sách/i,
    /quy (trình|định)/i,
    /thủ tục/i,
    /làm (sao|thế nào)/i,
    /cách nào/i,
    /hướng dẫn/i,
    /thai sản/i,
    /bảo hiểm/i,
  ],
  DATA_QUERY: [
    /còn (bao nhiêu|mấy).*(phép|ngày)/i,
    /số ngày (phép|nghỉ)/i,
    /lương.*tháng/i,
    /ngày công/i,
    /giờ (tăng ca|OT)/i,
    /chấm công/i,
    /thông tin (của tôi|cá nhân)/i,
  ],
  ACTION_REQUEST: [
    /tạo (đơn|yêu cầu)/i,
    /(xin|đăng ký).*(nghỉ|phép|tăng ca)/i,
    /submit/i,
    /gửi đơn/i,
    /đặt lịch/i,
  ],
  REPORT_REQUEST: [
    /báo cáo/i,
    /thống kê/i,
    /tổng hợp/i,
    /xuất (file|excel|pdf)/i,
    /report/i,
  ],
  GENERAL_CHAT: [
    /^(xin )?chào/i,
    /cảm ơn/i,
    /thanks/i,
    /^hi$/i,
    /^hello$/i,
    /tạm biệt/i,
    /bye/i,
  ],
  UNKNOWN: [],
};

/**
 * Quick local intent classification using patterns
 * Returns null if no confident match
 */
export function classifyIntentLocal(message: string): AIIntentType | null {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (intent === "UNKNOWN") continue;

    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return intent as AIIntentType;
      }
    }
  }
  return null;
}

/**
 * Classify intent using AI when local classification fails
 */
export async function classifyIntentAI(message: string): Promise<AIIntentType> {
  try {
    const result = await classify(message, INTENT_CLASSIFIER_PROMPT);
    const intent = result.toUpperCase().trim();

    // Validate the intent
    const validIntents: AIIntentType[] = [
      "FAQ",
      "DATA_QUERY",
      "ACTION_REQUEST",
      "REPORT_REQUEST",
      "GENERAL_CHAT",
      "UNKNOWN",
    ];

    if (validIntents.includes(intent as AIIntentType)) {
      return intent as AIIntentType;
    }

    return "UNKNOWN";
  } catch (error) {
    console.error("Intent classification error:", error);
    return "UNKNOWN";
  }
}

/**
 * Combined intent classification
 * Tries local first, falls back to AI
 */
export async function classifyIntent(message: string): Promise<AIIntentType> {
  // Try local classification first
  const localIntent = classifyIntentLocal(message);
  if (localIntent) {
    return localIntent;
  }

  // Fall back to AI classification
  return classifyIntentAI(message);
}
