import { Injectable, NotFoundException } from '@nestjs/common';
import { GuardianshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface UpdateGuardianshipInput {
  relationshipLabel?: string;
  canViewBalance?: boolean;
  canViewTransactions?: boolean;
  canReceiveAlerts?: boolean;
}

@Injectable()
export class GuardianshipsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const g = await this.prisma.guardianship.findUnique({
      where: { id },
      include: { guardian: true, family: { include: { parent: true } } },
    });
    if (!g) throw new NotFoundException(`Guardianship ${id} not found`);
    return g;
  }

  async update(id: string, input: UpdateGuardianshipInput) {
    await this.findById(id); // 404 if missing
    return this.prisma.guardianship.update({
      where: { id },
      data: {
        relationshipLabel: input.relationshipLabel,
        canViewBalance: input.canViewBalance,
        canViewTransactions: input.canViewTransactions,
        canReceiveAlerts: input.canReceiveAlerts,
      },
    });
  }

  async revoke(id: string) {
    await this.findById(id);
    return this.prisma.guardianship.update({
      where: { id },
      data: { status: GuardianshipStatus.REVOKED, sunsetAt: new Date() },
    });
  }

  serialize(g: Awaited<ReturnType<GuardianshipsService['findById']>>) {
    const statusToLabel: Record<GuardianshipStatus, string> = {
      ACTIVE: 'Connected',
      PAUSED: 'Paused',
      REVOKED: 'Removed',
    };
    return {
      guardianshipId: g.id,
      familyId: g.familyId,
      status: g.status,
      statusLabel: statusToLabel[g.status],
      relationshipLabel: g.relationshipLabel ?? 'Guardian',
      sunsetAt: g.sunsetAt,
      createdAt: g.createdAt,
      permissions: {
        viewBalance: g.canViewBalance,
        viewTransactions: g.canViewTransactions,
        receiveAlerts: g.canReceiveAlerts,
      },
      guardian: {
        userId: g.guardian.id,
        fullName: g.guardian.fullName,
        phone: g.guardian.phone,
        avatarUrl: g.guardian.avatarUrl,
      },
      parent: {
        userId: g.family.parent.id,
        fullName: g.family.parent.fullName,
      },
    };
  }
}
