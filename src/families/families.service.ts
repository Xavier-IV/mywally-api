import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GuardianshipStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateFamilyInput {
  parentName: string;
  parentPhone?: string;
  guardianName: string;
  guardianPhone: string;
  relationshipLabel?: string;
  initialBalance?: number;
}

@Injectable()
export class FamiliesService {
  private readonly logger = new Logger(FamiliesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateFamilyInput) {
    const guardianPhone = input.guardianPhone.trim();
    const parentPhone = input.parentPhone?.trim() || `+60demo${Date.now().toString().slice(-7)}`;

    const parent = await this.prisma.user.create({
      data: { role: UserRole.PARENT, fullName: input.parentName, phone: parentPhone },
    });

    const guardian = await this.prisma.user.upsert({
      where: { phone: guardianPhone },
      update: { fullName: input.guardianName, role: UserRole.GUARDIAN },
      create: { role: UserRole.GUARDIAN, fullName: input.guardianName, phone: guardianPhone },
    });

    const family = await this.prisma.family.create({
      data: {
        parentId: parent.id,
        agreementSignedAt: new Date(),
        balance: input.initialBalance ?? 1568.97,
        guardianships: {
          create: {
            guardianId: guardian.id,
            status: GuardianshipStatus.ACTIVE,
            relationshipLabel: input.relationshipLabel ?? 'Daughter',
          },
        },
      },
      include: { parent: true, guardianships: { include: { guardian: true } } },
    });

    this.logger.log(`Created family ${family.id} parent=${parent.fullName} guardian=${guardian.phone}`);
    return family;
  }

  async list() {
    const families = await this.prisma.family.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        parent: true,
        guardianships: { include: { guardian: true } },
        transactions: {
          select: { id: true, state: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    return families.map((f) => {
      const gship = f.guardianships.find((x) => x.status === 'ACTIVE');
      return {
        familyId: f.id,
        createdAt: f.createdAt,
        balance: f.balance.toString(),
        parent: { id: f.parent.id, fullName: f.parent.fullName, phone: f.parent.phone },
        guardian: gship
          ? {
              id: gship.guardian.id,
              fullName: gship.guardian.fullName,
              phone: gship.guardian.phone,
              relationshipLabel: gship.relationshipLabel ?? 'Guardian',
            }
          : null,
        latestTransaction: f.transactions[0] ?? null,
      };
    });
  }

  async findById(id: string) {
    const family = await this.prisma.family.findUnique({
      where: { id },
      include: { parent: true, guardianships: { include: { guardian: true } } },
    });
    if (!family) throw new NotFoundException(`Family ${id} not found`);
    const gship = family.guardianships.find((x) => x.status === 'ACTIVE');
    return {
      familyId: family.id,
      balance: family.balance.toString(),
      parent: { fullName: family.parent.fullName, phone: family.parent.phone },
      guardian: gship
        ? {
            fullName: gship.guardian.fullName,
            phone: gship.guardian.phone,
            relationshipLabel: gship.relationshipLabel ?? 'Guardian',
          }
        : null,
    };
  }
}
