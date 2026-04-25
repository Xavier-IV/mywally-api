import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import {
  LlmGenerateInput,
  LlmGenerateOutput,
  LlmProvider,
} from './llm-provider.interface';

@Injectable()
export class BedrockProvider implements LlmProvider {
  readonly name = 'bedrock';
  private readonly logger = new Logger(BedrockProvider.name);
  private client: BedrockRuntimeClient | null = null;
  private model = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('AWS_BEARER_TOKEN_BEDROCK');
    const region = this.config.get<string>('AWS_REGION') ?? 'ap-southeast-1';
    this.model = this.config.get<string>('BEDROCK_MODEL') ?? this.model;

    if (apiKey) {
      // The Bedrock SDK reads AWS_BEARER_TOKEN_BEDROCK from process.env.
      // Mirror it here in case .env loaded after process.env was read.
      process.env.AWS_BEARER_TOKEN_BEDROCK = apiKey;
      this.client = new BedrockRuntimeClient({ region });
      this.logger.log(`Bedrock client ready (model=${this.model}, region=${region})`);
    } else {
      this.logger.warn('AWS_BEARER_TOKEN_BEDROCK not set');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generate(input: LlmGenerateInput): Promise<LlmGenerateOutput> {
    if (!this.client) throw new Error('Bedrock client is not configured');

    const messages: Message[] = [];
    for (const turn of input.turns) {
      if (turn.role === 'user') {
        messages.push({ role: 'user', content: [{ text: turn.text }] });
      } else if (turn.role === 'assistant') {
        const blocks: ContentBlock[] = [];
        if (turn.text) blocks.push({ text: turn.text });
        if (turn.toolUse) {
          blocks.push({
            toolUse: {
              toolUseId: turn.toolUse.id,
              name: turn.toolUse.name,
              input: turn.toolUse.input as any,
            },
          });
        }
        if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks });
      } else if (turn.role === 'tool') {
        messages.push({
          role: 'user',
          content: [
            {
              toolResult: {
                toolUseId: turn.toolUseId,
                content: [{ text: turn.content }],
              },
            },
          ],
        });
      }
    }

    const tools: Tool[] = input.tools.map(
      (t) =>
        ({
          toolSpec: {
            name: t.name,
            description: t.description,
            inputSchema: { json: t.inputSchema },
          },
        }) as Tool,
    );

    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.model,
        system: [{ text: input.systemPrompt }],
        messages,
        toolConfig: tools.length > 0 ? { tools } : undefined,
        inferenceConfig: { maxTokens: 1024 },
      }),
    );

    let text = '';
    let toolUse: LlmGenerateOutput['toolUse'];
    for (const block of response.output?.message?.content ?? []) {
      if ('text' in block && block.text) text += block.text;
      if ('toolUse' in block && block.toolUse) {
        toolUse = {
          name: block.toolUse.name ?? '',
          input: (block.toolUse.input ?? {}) as Record<string, unknown>,
          toolUseId: block.toolUse.toolUseId ?? '',
        };
      }
    }

    return { text: text || undefined, toolUse };
  }
}
