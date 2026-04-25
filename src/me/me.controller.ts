import { Body, Controller, ForbiddenException, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { GuardianshipsService } from '../guardianships/guardianships.service';
import { BudgetDto } from '../budgets/budgets.controller';
import { BudgetsService } from '../budgets/budgets.service';

@ApiTags('me')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guardianships: GuardianshipsService,
    private readonly budgets: BudgetsService,
  ) {}

  private async resolveFamilyIdForUser(user: User): Promise<string> {
    if (user.role === 'PARENT') {
      const f = await this.prisma.family.findFirst({ where: { parentId: user.id } });
      if (!f) throw new ForbiddenException('No family for this parent');
      return f.id;
    }
    const g = await this.prisma.guardianship.findFirst({
      where: { guardianId: user.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!g) throw new ForbiddenException('No active guardianship for this user');
    return g.familyId;
  }

  @Get()
  @ApiOperation({ summary: 'Logged-in user profile' })
  me(@CurrentUser() user: User) {
    return {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
    };
  }

  @Get('budget')
  @ApiOperation({ summary: 'Get the budget for the current user\'s family (BFF)' })
  async getBudget(@CurrentUser() user: User) {
    const familyId = await this.resolveFamilyIdForUser(user);
    return this.budgets.findByFamilyId(familyId);
  }

  @Put('budget')
  @ApiOperation({ summary: 'Replace the budget for the current user\'s family (BFF)' })
  async putBudget(@CurrentUser() user: User, @Body() dto: BudgetDto) {
    if (user.role !== 'PARENT') {
      throw new ForbiddenException('Only the parent can change the family budget');
    }
    const familyId = await this.resolveFamilyIdForUser(user);
    return this.budgets.upsertForFamilyId(familyId, dto);
  }

  @Get('members/:guardianshipId')
  @ApiOperation({
    summary: 'Member detail BFF (Onboard-Screen 5)',
    description: 'Returns the guardianship in the shape the member-detail screen renders. Caller must be the parent of that family.',
  })
  async memberDetail(
    @CurrentUser() user: User,
    @Param('guardianshipId') guardianshipId: string,
  ) {
    const g = await this.guardianships.findById(guardianshipId);
    if (g.family.parentId !== user.id) {
      throw new ForbiddenException('You can only view members of your own family');
    }
    return this.guardianships.serialize(g);
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Dashboard data for the logged-in user',
    description:
      'For PARENT: returns family balance + members (guardians) with relationship labels. ' +
      'For GUARDIAN: returns the parents they protect.',
  })
  async dashboard(@CurrentUser() user: User) {
    if (user.role === 'PARENT') {
      const family = await this.prisma.family.findFirst({
        where: { parentId: user.id },
        include: {
          guardianships: {
            where: { status: 'ACTIVE' },
            include: { guardian: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!family) return { error: 'No family found' };
      return {
        role: 'PARENT',
        greeting: user.fullName,
        balance: { amount: family.balance.toString(), currency: 'MYR' },
        familyId: family.id,
        members: family.guardianships.map((g) => ({
          guardianshipId: g.id,
          userId: g.guardian.id,
          fullName: g.guardian.fullName,
          phone: g.guardian.phone,
          avatarUrl: g.guardian.avatarUrl,
          relationshipLabel: g.relationshipLabel ?? 'Guardian',
        })),
      };
    }

    // GUARDIAN
    const guardianships = await this.prisma.guardianship.findMany({
      where: { guardianId: user.id, status: 'ACTIVE' },
      include: { family: { include: { parent: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      role: 'GUARDIAN',
      greeting: user.fullName,
      protects: guardianships.map((g) => ({
        guardianshipId: g.id,
        familyId: g.familyId,
        parent: {
          fullName: g.family.parent.fullName,
          phone: g.family.parent.phone,
          avatarUrl: g.family.parent.avatarUrl,
        },
        relationshipLabel: g.relationshipLabel ?? 'Family',
      })),
    };
  }
}
