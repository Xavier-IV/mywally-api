import { Body, Controller, Get, Inject, Param, Post, forwardRef } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { InterventionsService } from '../interventions/interventions.service';
import { TransactionsService } from './transactions.service';

class CreateTransactionDto {
  @ApiProperty({ description: 'Idempotency key. Use unique value per transaction; collisions return existing record.' })
  @IsString()
  externalRef!: string;

  @ApiProperty()
  @IsString()
  familyId!: string;

  @ApiProperty({ example: 1500, description: 'Amount in major units (RM, not sen)' })
  @IsNumber()
  amount!: number;

  @ApiProperty({ example: 'MYR' })
  @IsString()
  currency!: string;

  @ApiProperty({ example: 'Unknown Maybank Account' })
  @IsString()
  recipientName!: string;

  @ApiProperty({ example: 'MAYBANK ****1234' })
  @IsString()
  recipientHandle!: string;

  @ApiProperty({ required: false, example: 'transfer' })
  @IsOptional()
  @IsString()
  merchantCategory?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isFirstTimeRecipient!: boolean;
}

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly txns: TransactionsService,
    @Inject(forwardRef(() => InterventionsService))
    private readonly interventions: InterventionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Submit a transaction for risk evaluation',
    description:
      'Same path TNG would call. Returns the resulting state synchronously (RECEIVED -> SCORED -> HELD or RELEASED). ' +
      'If HELD, a guardian intervention call is fired asynchronously.',
  })
  async create(@Body() dto: CreateTransactionDto) {
    const tx = await this.txns.ingest(dto);
    if (tx.state === 'HELD') {
      this.interventions.startGuardianCall(tx.id).catch(() => undefined);
    }
    return {
      transactionId: tx.id,
      externalRef: tx.externalRef,
      state: tx.state,
      riskScore: tx.riskScore,
      riskReasons: tx.riskReasons,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get current state of a transaction',
    description: 'Polled by the merchant simulator UI; in production a push webhook back to TNG would replace this.',
  })
  async findOne(@Param('id') id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      include: { decisions: { orderBy: { createdAt: 'desc' } } },
    });
    if (!tx) return { error: 'not found' };
    const latestDecision = tx.decisions[0];
    return {
      transactionId: tx.id,
      state: tx.state,
      riskScore: tx.riskScore,
      riskReasons: tx.riskReasons,
      decidedAt: tx.decidedAt,
      decisionReason: tx.decisionReason,
      latestDecision: latestDecision
        ? {
            action: latestDecision.action,
            channel: latestDecision.channel,
            dtmf: latestDecision.dtmf,
            createdAt: latestDecision.createdAt,
          }
        : null,
    };
  }

  @Post(':id/unblock')
  @ApiOperation({
    summary: 'Override a BLOCKED or ABORTED transaction back to RELEASED',
    description: 'Demo helper / appeal flow. Records an UNBLOCKED audit event; original DecisionLog rows are preserved.',
  })
  unblock(@Param('id') id: string) {
    return this.txns.unblock(id, 'manual_override');
  }
}
