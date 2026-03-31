// ============================================================
// @vierp/ai-copilot — ERP AI Copilot (Enterprise Tier)
//
// Usage:
//   import { createCopilot } from '@vierp/ai-copilot';
//   const copilot = createCopilot({ apiKey: process.env.ANTHROPIC_API_KEY });
//   const response = await copilot.chat('Tóm tắt doanh thu tháng này', context);
// ============================================================

export { CopilotEngine } from './core/engine';
export { buildERPContext, classifyIntent, estimateTokens, truncateContext } from './core/context-builder';
export { ALL_ASSISTANTS, hrmAssistant, accountingAssistant, mrpAssistant, crmAssistant, generalAssistant } from './modules';
export type {
  CopilotConfig, ConversationContext, ChatMessage, CopilotResponse,
  CopilotTool, ModuleAssistant, StreamChunk, SuggestedAction, DataCard,
  CopilotModule, ToolCall, ToolResult,
} from './types';

import { CopilotEngine } from './core/engine';
import { ALL_ASSISTANTS } from './modules';
import type { CopilotConfig } from './types';

/**
 * Factory: Create a fully configured copilot with all module assistants
 */
export function createCopilot(config: CopilotConfig): CopilotEngine {
  const engine = new CopilotEngine(config);

  // Register all module assistants
  const enabledModules = config.enabledModules || ['hrm', 'crm', 'mrp', 'accounting', 'general'];

  for (const assistant of ALL_ASSISTANTS) {
    if (enabledModules.includes(assistant.module)) {
      engine.registerAssistant(assistant);
    }
  }

  console.log(`[AI-COPILOT] Initialized with ${enabledModules.length} module assistants`);
  return engine;
}
