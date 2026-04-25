import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class ListMembersTool implements ChatTool {
  readonly name = 'list_family_members';
  readonly description = 'List the family members (guardians) for the parent\'s family.';
  readonly inputSchema = {
    type: 'object',
    properties: {},
  };
  readonly requiredRole = 'PARENT' as const;

  constructor(private readonly prisma: PrismaService) {}

  async execute(_input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const family = await this.prisma.family.findFirst({
      where: { parentId: ctx.user.id },
      include: {
        guardianships: {
          where: { status: 'ACTIVE' },
          include: { guardian: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!family) return { status: 'error', message: 'No family found.' };

    const members = family.guardianships.map((g) => ({
      guardianshipId: g.id,
      fullName: g.guardian.fullName,
      phone: g.guardian.phone,
      relationshipLabel: g.relationshipLabel ?? 'Guardian',
    }));

    return {
      status: 'success',
      message:
        members.length === 0
          ? 'You have no family members yet.'
          : `You have ${members.length} family member(s): ${members.map((m) => `${m.fullName} (${m.relationshipLabel})`).join(', ')}.`,
      data: { members },
    };
  }
}
