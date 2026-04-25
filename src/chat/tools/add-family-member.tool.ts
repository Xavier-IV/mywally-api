import { Injectable } from '@nestjs/common';
import { GuardianshipStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatTool, ToolContext, ToolResult } from './tool.interface';

@Injectable()
export class AddFamilyMemberTool implements ChatTool {
  readonly name = 'add_family_member';
  readonly description =
    'Add a new family member (guardian) to the parent\'s family. Used when the parent wants to invite their child or another trusted person.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      fullName: { type: 'string', description: 'Display name of the new member.' },
      phone: { type: 'string', description: 'Phone in E.164 format, e.g. +60138155761' },
      relationshipLabel: {
        type: 'string',
        description: 'Relationship to the parent (e.g. Daughter, Son, Spouse, Sibling).',
      },
    },
    required: ['fullName', 'phone', 'relationshipLabel'],
  };
  readonly requiredRole = 'PARENT' as const;

  constructor(private readonly prisma: PrismaService) {}

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const fullName = String(input.fullName ?? '').trim();
    const phone = String(input.phone ?? '').trim();
    const relationshipLabel = String(input.relationshipLabel ?? '').trim() || 'Guardian';

    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      return { status: 'error', message: `Phone must be E.164 format (got "${phone}")` };
    }

    const family = await this.prisma.family.findFirst({ where: { parentId: ctx.user.id } });
    if (!family) return { status: 'error', message: 'No family found for this parent.' };

    const guardian = await this.prisma.user.upsert({
      where: { phone },
      update: { fullName, role: UserRole.GUARDIAN },
      create: { role: UserRole.GUARDIAN, fullName, phone },
    });

    const existing = await this.prisma.guardianship.findUnique({
      where: { familyId_guardianId: { familyId: family.id, guardianId: guardian.id } },
    });
    if (existing) {
      return {
        status: 'error',
        message: `${fullName} is already in your family as ${existing.relationshipLabel ?? 'Guardian'}.`,
      };
    }

    const guardianship = await this.prisma.guardianship.create({
      data: {
        familyId: family.id,
        guardianId: guardian.id,
        relationshipLabel,
        status: GuardianshipStatus.ACTIVE,
      },
    });

    return {
      status: 'success',
      message: `Invitation sent to ${fullName} (${phone}). They've been added as your ${relationshipLabel}.`,
      data: {
        guardianshipId: guardianship.id,
        memberId: guardian.id,
        fullName,
        phone,
        relationshipLabel,
      },
      ui: [
        { kind: 'toast', level: 'success', message: `Added ${fullName} as ${relationshipLabel}` },
        { kind: 'refresh', resource: '/me/dashboard' },
      ],
    };
  }
}
