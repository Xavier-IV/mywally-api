import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  LlmGenerateInput,
  LlmGenerateOutput,
  LlmProvider,
} from './llm-provider.interface';

@Injectable()
export class AlibabaProvider implements LlmProvider {
  readonly name = 'alibaba';
  private readonly logger = new Logger(AlibabaProvider.name);
  private client: OpenAI | null = null;
  private model = 'qwen-max-latest';

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ALIBABA_API_KEY');
    this.model = this.config.get<string>('ALIBABA_MODEL') ?? this.model;
    const baseURL =
      this.config.get<string>('ALIBABA_BASE_URL') ??
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

    if (apiKey) {
      this.client = new OpenAI({ apiKey, baseURL });
      this.logger.log(`Alibaba (DashScope) client ready (model=${this.model}, baseURL=${baseURL})`);
    } else {
      this.logger.warn('ALIBABA_API_KEY not set');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generate(input: LlmGenerateInput): Promise<LlmGenerateOutput> {
    if (!this.client) throw new Error('Alibaba client is not configured');

    type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
    const messages: ChatMsg[] = [{ role: 'system', content: input.systemPrompt }];
    for (const turn of input.turns) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: turn.text });
      } else if (turn.role === 'assistant') {
        if (turn.toolUse) {
          messages.push({
            role: 'assistant',
            content: turn.text ?? null,
            tool_calls: [
              {
                id: turn.toolUse.id,
                type: 'function',
                function: {
                  name: turn.toolUse.name,
                  arguments: JSON.stringify(turn.toolUse.input ?? {}),
                },
              },
            ],
          });
        } else if (turn.text) {
          messages.push({ role: 'assistant', content: turn.text });
        }
      } else if (turn.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: turn.toolUseId, content: turn.content });
      }
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: input.tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema as Record<string, unknown>,
        },
      })),
      tool_choice: 'auto',
    });

    const choice = response.choices[0];
    const text = choice.message.content ?? undefined;
    const tc = choice.message.tool_calls?.[0];
    let toolUse: LlmGenerateOutput['toolUse'];
    if (tc && tc.type === 'function') {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(tc.function.arguments || '{}');
      } catch {
        this.logger.warn(`Failed to parse tool args: ${tc.function.arguments}`);
      }
      toolUse = { name: tc.function.name, input: parsed, toolUseId: tc.id };
    }
    return { text, toolUse };
  }
}
