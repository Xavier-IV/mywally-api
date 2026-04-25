import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmGenerateInput,
  LlmGenerateOutput,
  LlmProvider,
} from './llm-provider.interface';

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private client: Anthropic | null = null;
  private model = 'claude-sonnet-4-6';

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.model = this.config.get<string>('LLM_MODEL') ?? this.model;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.logger.log(`Anthropic client ready (model=${this.model})`);
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set - chat will use scripted fallback');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generate(input: LlmGenerateInput): Promise<LlmGenerateOutput> {
    if (!this.client) throw new Error('Anthropic client is not configured');

    const messages: Anthropic.MessageParam[] = [];
    for (const turn of input.turns) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: turn.text });
      } else if (turn.role === 'assistant') {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (turn.text) blocks.push({ type: 'text', text: turn.text });
        if (turn.toolUse) {
          blocks.push({
            type: 'tool_use',
            id: turn.toolUse.id,
            name: turn.toolUse.name,
            input: turn.toolUse.input,
          });
        }
        if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks });
      } else if (turn.role === 'tool') {
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: turn.toolUseId, content: turn.content }],
        });
      }
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: input.systemPrompt,
      tools: input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      messages,
    });

    let text = '';
    let toolUse: LlmGenerateOutput['toolUse'];
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use') {
        toolUse = {
          name: block.name,
          input: block.input as Record<string, unknown>,
          toolUseId: block.id,
        };
      }
    }
    return { text: text || undefined, toolUse };
  }
}
