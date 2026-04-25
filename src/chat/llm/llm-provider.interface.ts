export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Internal conversation turn passed to the provider. Richer than the FE-facing
 * ChatHistoryMessage because we also model assistant tool_use turns and tool_result turns.
 */
export type LlmTurn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; toolUse?: { id: string; name: string; input: Record<string, unknown> } }
  | { role: 'tool'; toolUseId: string; content: string };

export interface LlmGenerateInput {
  systemPrompt: string;
  turns: LlmTurn[];
  tools: LlmToolSpec[];
}

export interface LlmGenerateOutput {
  text?: string;
  toolUse?: { name: string; input: Record<string, unknown>; toolUseId: string };
}

export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(input: LlmGenerateInput): Promise<LlmGenerateOutput>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
