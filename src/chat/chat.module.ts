import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AlibabaProvider } from './llm/alibaba.provider';
import { AnthropicProvider } from './llm/anthropic.provider';
import { BedrockProvider } from './llm/bedrock.provider';
import { LLM_PROVIDER, LlmProvider } from './llm/llm-provider.interface';
import { MoonshotProvider } from './llm/moonshot.provider';
import { AddFamilyMemberTool } from './tools/add-family-member.tool';
import { GetBalanceTool } from './tools/get-balance.tool';
import { GetSpendingTool } from './tools/get-spending.tool';
import { ListMembersTool } from './tools/list-members.tool';
import { SetBudgetTool } from './tools/set-budget.tool';
import { ToolRegistry } from './tools/tool.registry';

@Module({
  imports: [AuthModule, BudgetsModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    AlibabaProvider,
    AnthropicProvider,
    BedrockProvider,
    MoonshotProvider,
    {
      provide: LLM_PROVIDER,
      useFactory: (
        config: ConfigService,
        alibaba: AlibabaProvider,
        anthropic: AnthropicProvider,
        bedrock: BedrockProvider,
        moonshot: MoonshotProvider,
      ): LlmProvider => {
        const log = new Logger('LlmProviderFactory');
        const explicit = config.get<string>('LLM_PROVIDER')?.toLowerCase();
        const byName: Record<string, LlmProvider> = {
          alibaba,
          bedrock,
          anthropic,
          moonshot,
        };
        if (explicit && byName[explicit]) {
          log.log(`Using ${explicit} (explicit)`);
          return byName[explicit];
        }
        // auto: prefer in this order
        for (const p of [bedrock, alibaba, anthropic, moonshot]) {
          if (p.isConfigured()) {
            log.log(`Using ${p.name} (auto-detected)`);
            return p;
          }
        }
        log.warn('No LLM provider configured - chat will use scripted fallback');
        return bedrock; // returns "not configured" - fallback path kicks in
      },
      inject: [
        ConfigService,
        AlibabaProvider,
        AnthropicProvider,
        BedrockProvider,
        MoonshotProvider,
      ],
    },
    ToolRegistry,
    AddFamilyMemberTool,
    ListMembersTool,
    SetBudgetTool,
    GetBalanceTool,
    GetSpendingTool,
  ],
})
export class ChatModule {}
