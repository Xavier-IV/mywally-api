import { Injectable, NotFoundException } from '@nestjs/common';
import { BudgetPeriod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface BudgetInput {
  amount: number;
  period: BudgetPeriod;
  warningThresholdPercent: number;
}

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByFamilyId(familyId: string) {
    const f = await this.prisma.family.findUnique({ where: { id: familyId } });
    if (!f) throw new NotFoundException(`Family ${familyId} not found`);
    return this.serialize(f);
  }

  async upsertForFamilyId(familyId: string, input: BudgetInput) {
    const f = await this.prisma.family.findUnique({ where: { id: familyId } });
    if (!f) throw new NotFoundException(`Family ${familyId} not found`);
    const updated = await this.prisma.family.update({
      where: { id: familyId },
      data: {
        budgetAmount: input.amount,
        budgetPeriod: input.period,
        warningThresholdPercent: input.warningThresholdPercent,
      },
    });
    return this.serialize(updated);
  }

  private serialize(f: {
    id: string;
    budgetAmount: { toString(): string };
    budgetPeriod: BudgetPeriod;
    warningThresholdPercent: number;
  }) {
    return {
      familyId: f.id,
      amount: { value: f.budgetAmount.toString(), currency: 'MYR' },
      period: f.budgetPeriod,
      warningThresholdPercent: f.warningThresholdPercent,
    };
  }
}
