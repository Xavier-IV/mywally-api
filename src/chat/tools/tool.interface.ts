import { User } from '@prisma/client';

export type RoleRequirement = 'PARENT' | 'GUARDIAN' | 'ANY';

export type GuardianPermission = 'viewBalance' | 'viewTransactions' | 'receiveAlerts';

export interface ToolContext {
  user: User;
  familyId?: string;
}

export interface ToolUiHint {
  kind: 'navigate' | 'toast' | 'refresh';
  [key: string]: unknown;
}

export interface ToolResult {
  status: 'success' | 'error';
  message: string;
  data?: unknown;
  ui?: ToolUiHint[];
}

export interface ChatTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly requiredRole: RoleRequirement;
  readonly requiredGuardianPermissions?: GuardianPermission[];
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export const CHAT_TOOLS = Symbol('CHAT_TOOLS');
