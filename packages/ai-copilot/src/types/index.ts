// ============================================================
// @vierp/ai-copilot — Type Definitions (LIPHOCO Extended)
// ============================================================

export type CopilotModule =
  | 'hrm'
  | 'crm'
  | 'mrp'
  | 'accounting'
  | 'otb'
  | 'pm'
  | 'tpm'
  | 'excel-ai'
  | 'costing'      // ← NEW: LIPHOCO Costing module
  | 'general';

export interface CopilotConfig {
  apiKey: string;
  model?: string;              // default: claude-sonnet-4-20250514
  maxTokens?: number;          // default: 4096
  temperature?: number;        // default: 0.3 for structured, 0.7 for creative
  language?: 'vi' | 'en';     // default: 'vi'
  enabledModules?: CopilotModule[];
}

export interface ConversationContext {
  conversationId: string;
  userId: string;
  tenantId: string;
  tier: 'basic' | 'pro' | 'enterprise';
  module: CopilotModule;
  language: 'vi' | 'en';
  history: ChatMessage[];
  metadata: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface CopilotTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface CopilotModuleDefinition {
  id: CopilotModule;
  name: string;
  description: string;
  tools: CopilotTool[];
  systemPrompt: string;
}
