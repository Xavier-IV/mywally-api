import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddFamilyMemberTool } from './add-family-member.tool';
import { GetBalanceTool } from './get-balance.tool';
import { GetSpendingTool } from './get-spending.tool';
import { ListMembersTool } from './list-members.tool';
import { SetBudgetTool } from './set-budget.tool';
import { ChatTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools: ChatTool[];

  constructor(
    private readonly prisma: PrismaService,
    addMember: AddFamilyMemberTool,
    listMembers: ListMembersTool,
    setBudget: SetBudgetTool,
    getBalance: GetBalanceTool,
    getSpending: GetSpendingTool,
  ) {
    this.tools = [addMember, listMembers, setBudget, getBalance, getSpending];
  }

  /** Tools the LLM should be told about for this user (filtered by role + permissions). */
  async toolsForUser(user: User): Promise<ChatTool[]> {
    const out: ChatTool[] = [];
    for (const t of this.tools) {
      if (await this.isAllowed(t, user)) out.push(t);
    }
    return out;
  }

  /** Server-side enforcement before executing a tool. Never trust the LLM. */
  async assertAllowed(toolName: string, user: User): Promise<ChatTool> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) throw new NotFoundException(`Tool ${toolName} not found`);
    const ok = await this.isAllowed(tool, user);
    if (!ok) throw new ForbiddenException(`User ${user.id} not allowed to call ${toolName}`);
    return tool;
  }

  async execute(toolName: string, input: Record<string, unknown>, user: User): Promise<ToolResult> {
    const tool = await this.assertAllowed(toolName, user);
    const ctx: ToolContext = { user };
    try {
      return await tool.execute(input, ctx);
    } catch (err: any) {
      this.logger.error(`Tool ${toolName} failed: ${err.message}`);
      return { status: 'error', message: err.message ?? 'Tool execution failed' };
    }
  }

  private async isAllowed(tool: ChatTool, user: User): Promise<boolean> {
    if (tool.requiredRole !== 'ANY' && tool.requiredRole !== user.role) return false;
    if (
      user.role === 'GUARDIAN' &&
      tool.requiredGuardianPermissions &&
      tool.requiredGuardianPermissions.length > 0
    ) {
      const g = await this.prisma.guardianship.findFirst({
        where: { guardianId: user.id, status: 'ACTIVE' },
      });
      if (!g) return false;
      const flags: Record<string, boolean> = {
        viewBalance: g.canViewBalance,
        viewTransactions: g.canViewTransactions,
        receiveAlerts: g.canReceiveAlerts,
      };
      for (const p of tool.requiredGuardianPermissions) {
        if (!flags[p]) return false;
      }
    }
    return true;
  }
}
