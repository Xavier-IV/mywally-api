import { Injectable } from '@nestjs/common';
import { Prisma, BudgetPeriod } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class GetSpendingTool implements ChatTool {
  readonly name = 'get_spending_summary';
  readonly description =
    'Get the user\'s spending vs budget for the current period. Returns the amount spent today (or this week/month if budget period is weekly/monthly), the budget cap, and the percent used. Use when the user asks "how much have I spent today", "what is my balance left", "am I within my budget".';
  readonly inputSchema = { type: 'object', properties: {} };
  readonly requiredRole = 'ANY' as const;
  readonly requiredGuardianPermissions = ['viewTransactions' as const];

  constructor(private readonly prisma: PrismaService) {}

  async execute(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    let family;
    if (ctx.user.role === 'PARENT') {
      family = await this.prisma.family.findFirst({ where: { parentId: ctx.user.id } });
    } else {
      const g = await this.prisma.guardianship.findFirst({
        where: { guardianId: ctx.user.id, status: 'ACTIVE' },
        include: { family: true },
      });
      family = g?.family ?? null;
    }
    if (!family) return { status: 'error', message: 'No family found.' };

    const now = new Date();
    const start = startOfPeriod(now, family.budgetPeriod);

    const aggregate = await this.prisma.transaction.aggregate({
      where: {
        familyId: family.id,
        state: 'RELEASED',
        createdAt: { gte: start },
      },
      _sum: { amount: true },
    });

    const spent = Number((aggregate._sum.amount ?? new Prisma.Decimal(0)).toString());
    const budget = Number(family.budgetAmount.toString());
    const remaining = Math.max(0, budget - spent);
    const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
    const periodLabel = family.budgetPeriod.toLowerCase();

    return {
      status: 'success',
      message:
        `${ctx.user.fullName} has spent RM${spent.toFixed(2)} ${periodLabel} so far ` +
        `(RM${remaining.toFixed(2)} of the RM${budget.toFixed(2)} budget remaining, ${percent}% used).`,
      data: {
        period: family.budgetPeriod,
        currency: 'MYR',
        spent: spent.toFixed(2),
        budget: budget.toFixed(2),
        remaining: remaining.toFixed(2),
        percentUsed: percent,
        warningThresholdPercent: family.warningThresholdPercent,
        rangeStart: start.toISOString(),
        rangeEnd: now.toISOString(),
      },
    };
  }
}

function startOfPeriod(now: Date, period: BudgetPeriod): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'DAILY') return d;
  if (period === 'WEEKLY') {
    const day = d.getDay(); // Sun=0
    const diff = (day + 6) % 7; // make Mon=0
    d.setDate(d.getDate() - diff);
    return d;
  }
  // MONTHLY
  d.setDate(1);
  return d;
}
