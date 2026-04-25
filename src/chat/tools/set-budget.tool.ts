import { Injectable } from '@nestjs/common';
import { BudgetPeriod } from '@prisma/client';
import { BudgetsService } from '../../budgets/budgets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class SetBudgetTool implements ChatTool {
  readonly name = 'set_budget';
  readonly description =
    'Set or change the spending budget for the parent\'s family. Used when the user says things like "set my daily budget to RM 200" or "I want a weekly budget of 500".';
  readonly inputSchema = {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'Budget cap in ringgit (RM).' },
      period: {
        type: 'string',
        enum: ['DAILY', 'WEEKLY', 'MONTHLY'],
        description: 'How often the budget resets.',
      },
      warningThresholdPercent: {
        type: 'integer',
        minimum: 20,
        maximum: 100,
        description: 'Alert threshold as a percentage of the budget. Defaults to 80.',
      },
    },
    required: ['amount', 'period'],
  };
  readonly requiredRole = 'PARENT' as const;

  constructor(
    private readonly budgets: BudgetsService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const family = await this.prisma.family.findFirst({ where: { parentId: ctx.user.id } });
    if (!family) return { status: 'error', message: 'No family found.' };

    const amount = Number(input.amount);
    const period = String(input.period) as BudgetPeriod;
    const threshold = Number(input.warningThresholdPercent ?? 80);

    if (!Number.isFinite(amount) || amount < 0) {
      return { status: 'error', message: 'Amount must be a non-negative number.' };
    }
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(period)) {
      return { status: 'error', message: 'Period must be DAILY, WEEKLY, or MONTHLY.' };
    }

    const result = await this.budgets.upsertForFamilyId(family.id, {
      amount,
      period,
      warningThresholdPercent: threshold,
    });

    return {
      status: 'success',
      message: `Budget set: RM ${amount} per ${period.toLowerCase()}, with alerts at ${threshold}%.`,
      data: result,
      ui: [
        { kind: 'toast', level: 'success', message: 'Budget updated' },
        { kind: 'refresh', resource: '/me/budget' },
      ],
    };
  }
}
