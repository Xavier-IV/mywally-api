import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class GetBalanceTool implements ChatTool {
  readonly name = 'get_balance';
  readonly description =
    'Get the available balance for the user\'s family. Parents see their own balance; guardians see the parent\'s balance only if they have viewBalance permission.';
  readonly inputSchema = { type: 'object', properties: {} };
  readonly requiredRole = 'ANY' as const;
  readonly requiredGuardianPermissions = ['viewBalance' as const];

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
    return {
      status: 'success',
      message: `Available balance is RM ${family.balance.toString()}.`,
      data: { amount: family.balance.toString(), currency: 'MYR' },
    };
  }
}
