import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, TransactionState, DecisionAction, DecisionChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RiskService, RiskInput } from '../risk/risk.service';

export interface CreateTxInput {
  externalRef: string;
  familyId: string;
  amount: number;
  currency: string;
  recipientName: string;
  recipientHandle: string;
  merchantCategory?: string;
  isFirstTimeRecipient: boolean;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: RiskService,
  ) {}

  async ingest(input: CreateTxInput) {
    const existing = await this.prisma.transaction.findUnique({
      where: { externalRef: input.externalRef },
    });
    if (existing) {
      this.logger.log(`Idempotent replay for ${input.externalRef}, returning existing tx`);
      return existing;
    }

    const family = await this.prisma.family.findUnique({
      where: { id: input.familyId },
      include: { guardianships: { include: { guardian: true } } },
    });
    if (!family) throw new NotFoundException(`Family ${input.familyId} not found`);

    const tx = await this.prisma.transaction.create({
      data: {
        externalRef: input.externalRef,
        familyId: input.familyId,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        recipientName: input.recipientName,
        recipientHandle: input.recipientHandle,
        merchantCategory: input.merchantCategory,
        isFirstTimeRecipient: input.isFirstTimeRecipient,
        state: TransactionState.RECEIVED,
      },
    });
    await this.appendEvent(tx.id, 'RECEIVED', { input });

    const riskInput: RiskInput = {
      amount: input.amount,
      currency: input.currency,
      recipientHandle: input.recipientHandle,
      isFirstTimeRecipient: input.isFirstTimeRecipient,
      merchantCategory: input.merchantCategory,
    };
    const riskOut = this.risk.evaluate(riskInput);

    const scored = await this.prisma.transaction.update({
      where: { id: tx.id },
      data: {
        state: TransactionState.SCORED,
        riskScore: riskOut.score,
        riskReasons: riskOut.reasons,
      },
    });
    await this.appendEvent(tx.id, 'SCORED', { score: riskOut.score, reasons: riskOut.reasons });

    if (riskOut.decision === 'PASS') {
      const released = await this.prisma.transaction.update({
        where: { id: tx.id },
        data: {
          state: TransactionState.RELEASED,
          decidedAt: new Date(),
          decisionReason: 'auto_pass_low_risk',
        },
      });
      await this.appendEvent(tx.id, 'RELEASED', { reason: 'auto_pass_low_risk' });
      return released;
    }

    const held = await this.prisma.transaction.update({
      where: { id: tx.id },
      data: { state: TransactionState.HELD, heldAt: new Date() },
    });
    await this.appendEvent(tx.id, 'HELD', { reasons: riskOut.reasons });
    return held;
  }

  async markCalling(txId: string, callSid: string) {
    await this.prisma.transaction.update({
      where: { id: txId },
      data: { state: TransactionState.CALLING },
    });
    await this.appendEvent(txId, 'CALLING', { callSid });
  }

  async recordDecision(
    txId: string,
    guardianId: string,
    action: DecisionAction,
    channel: DecisionChannel,
    extra: { dtmf?: string; pinAttempts?: number; twilioCallSid?: string } = {},
  ) {
    await this.prisma.decisionLog.create({
      data: {
        transactionId: txId,
        guardianId,
        channel,
        action,
        dtmf: extra.dtmf,
        pinAttempts: extra.pinAttempts ?? 0,
        twilioCallSid: extra.twilioCallSid,
      },
    });

    let nextState: TransactionState | null = null;
    let reason = '';
    switch (action) {
      case DecisionAction.APPROVE:
        nextState = TransactionState.RELEASED;
        reason = 'guardian_approved';
        break;
      case DecisionAction.REJECT:
        nextState = TransactionState.BLOCKED;
        reason = 'guardian_rejected';
        break;
      case DecisionAction.CALL_PARENT:
        reason = 'guardian_requested_call';
        break;
      case DecisionAction.TIMEOUT:
        nextState = TransactionState.ABORTED;
        reason = 'no_response_default_reject';
        break;
    }

    if (nextState) {
      await this.prisma.transaction.update({
        where: { id: txId },
        data: {
          state: nextState,
          decidedAt: new Date(),
          decidedBy: guardianId,
          decisionReason: reason,
        },
      });
      await this.appendEvent(txId, nextState, { reason, action });
    } else {
      await this.appendEvent(txId, 'GUARDIAN_INITIATED_CALL', { reason, action });
    }
  }

  async unblock(txId: string, reason = 'manual_override') {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException(`Transaction ${txId} not found`);
    if (tx.state !== TransactionState.BLOCKED && tx.state !== TransactionState.ABORTED) {
      return { ok: false, message: `Cannot unblock from state ${tx.state}`, state: tx.state };
    }
    const updated = await this.prisma.transaction.update({
      where: { id: txId },
      data: {
        state: TransactionState.RELEASED,
        decisionReason: reason,
        decidedAt: new Date(),
      },
    });
    await this.appendEvent(txId, 'UNBLOCKED', { reason, fromState: tx.state });
    this.logger.log(`Transaction ${txId} unblocked (was ${tx.state})`);
    return { ok: true, state: updated.state };
  }

  async findById(id: string) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: { family: { include: { guardianships: { include: { guardian: true } }, parent: true } } },
    });
  }

  async findByExternalRef(ref: string) {
    return this.prisma.transaction.findUnique({ where: { externalRef: ref } });
  }

  private async appendEvent(transactionId: string, type: string, payload: unknown) {
    const last = await this.prisma.transactionEvent.findFirst({
      where: { transactionId },
      orderBy: { createdAt: 'desc' },
    });
    const prevHash = last?.hash ?? null;
    const payloadJson = JSON.stringify(payload);
    const ts = new Date().toISOString();
    const hash = createHash('sha256')
      .update(`${prevHash ?? ''}|${type}|${payloadJson}|${ts}`)
      .digest('hex');
    await this.prisma.transactionEvent.create({
      data: {
        transactionId,
        type,
        payload: payload as Prisma.InputJsonValue,
        prevHash,
        hash,
      },
    });
  }
}
