import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { User } from '@prisma/client';
import {
  ChatHistoryMessage,
  LlmToolSpec,
  LlmTurn,
  LLM_PROVIDER,
} from './llm/llm-provider.interface';
import type { LlmProvider } from './llm/llm-provider.interface';
import { ToolRegistry } from './tools/tool.registry';
import { ToolUiHint } from './tools/tool.interface';

export interface ChatRequest {
  text: string;
  history?: ChatHistoryMessage[];
}

export interface ChatActionRecord {
  type: string;
  tool: string;
  status: 'success' | 'error' | 'denied';
  data?: unknown;
  error?: string;
}

export interface ChatResponse {
  reply: { role: 'assistant'; text: string };
  actions: ChatActionRecord[];
  ui: ToolUiHint[];
  llm: { provider: string; configured: boolean };
}

const MAX_TOOL_HOPS = 4;

function buildSystemPrompt(): string {
  const now = new Date();
  const kl = now.toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `Current time: ${kl} (Asia/Kuala_Lumpur, MYT). ISO: ${now.toISOString()}.

${SYSTEM_PROMPT_BODY}`;
}

const SYSTEM_PROMPT_BODY = `You are myWally's family-safety assistant. The user is signed in already.
Your job is to help them manage their family setup, budget, and member permissions in a fintech app.

Rules:
- Be concise. Two short sentences max unless asked for detail.
- When the user asks to do something that maps to one of your tools, call the tool. Don't just describe.
- After a tool runs, summarise the result for the user in plain language. Reference the numbers from the tool output. Do not just say "done".
- For destructive actions (remove a member, change a permission), confirm in your reply before calling the tool.
- If a tool is not available to this user, politely explain you cannot do it for their role.
- Speak in the same language the user uses (English, Bahasa Melayu, Manglish all OK).

Formatting:
- Use real newline characters (\\n) to separate ideas. Do not write inline numbered lists like "1. ... 2. ...".
- For a list of options, put each item on its own line, optionally prefixed with "- " or "1. ".
- Plain text only. No markdown bold, no headings, no emoji unless the user uses one first.`;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly tools: ToolRegistry,
  ) {}

  async toolsForUser(user: User): Promise<LlmToolSpec[]> {
    const allowed = await this.tools.toolsForUser(user);
    return allowed.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async handleMessage(user: User, req: ChatRequest): Promise<ChatResponse> {
    const allowedTools = await this.tools.toolsForUser(user);
    const toolSpecs: LlmToolSpec[] = allowedTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    const history = req.history ?? [];

    if (!this.llm.isConfigured()) {
      return this.fallbackResponse(allowedTools.map((t) => t.name));
    }

    // Build the initial conversation as turns.
    const turns: LlmTurn[] = [
      ...history.map((m) =>
        m.role === 'user'
          ? ({ role: 'user', text: m.content } as LlmTurn)
          : ({ role: 'assistant', text: m.content } as LlmTurn),
      ),
      { role: 'user', text: req.text },
    ];

    const actions: ChatActionRecord[] = [];
    const ui: ToolUiHint[] = [];
    let finalText = '';

    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const out = await this.llm.generate({
        systemPrompt: buildSystemPrompt(),
        turns,
        tools: toolSpecs,
      });

      // Append the assistant turn (text or tool_use).
      turns.push({
        role: 'assistant',
        text: out.text,
        toolUse: out.toolUse
          ? { id: out.toolUse.toolUseId || randomUUID(), name: out.toolUse.name, input: out.toolUse.input }
          : undefined,
      });

      if (!out.toolUse) {
        finalText = out.text ?? '';
        break;
      }

      this.logger.log(`Tool hop ${hop}: ${out.toolUse.name}(${JSON.stringify(out.toolUse.input)})`);
      let toolResultContent: string;
      try {
        const result = await this.tools.execute(out.toolUse.name, out.toolUse.input, user);
        actions.push({
          type: out.toolUse.name.toUpperCase(),
          tool: out.toolUse.name,
          status: result.status,
          data: result.data,
        });
        if (result.ui) ui.push(...result.ui);
        toolResultContent = JSON.stringify({
          status: result.status,
          message: result.message,
          data: result.data,
        });
      } catch (err: any) {
        actions.push({
          type: out.toolUse.name.toUpperCase(),
          tool: out.toolUse.name,
          status: err.status === 403 ? 'denied' : 'error',
          error: err.message,
        });
        toolResultContent = JSON.stringify({ status: 'error', message: err.message });
      }

      turns.push({
        role: 'tool',
        toolUseId: out.toolUse.toolUseId,
        content: toolResultContent,
      });
    }

    if (!finalText) {
      finalText =
        actions.length > 0
          ? actions.map((a) => `${a.tool}: ${a.status}`).join('\n')
          : 'I am not sure how to help with that.';
    }

    return {
      reply: { role: 'assistant', text: finalText },
      actions,
      ui,
      llm: { provider: this.llm.name, configured: true },
    };
  }

  private fallbackResponse(allowed: string[]): ChatResponse {
    return {
      reply: {
        role: 'assistant',
        text:
          'The chatbot LLM is not configured. ' +
          'Tools available to you: ' +
          allowed.join(', ') +
          '. Use the REST endpoints directly for now.',
      },
      actions: [],
      ui: [],
      llm: { provider: this.llm.name, configured: false },
    };
  }
}
