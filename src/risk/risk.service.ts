import { Injectable, Logger } from '@nestjs/common';

export interface RiskInput {
  amount: number;
  currency: string;
  recipientHandle: string;
  isFirstTimeRecipient: boolean;
  merchantCategory?: string;
}

export interface RiskOutput {
  decision: 'PASS' | 'HOLD';
  score: number;
  reasons: string[];
}

const MED_RISK = 40;
const HIGH_RISK = 70;

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  evaluate(input: RiskInput): RiskOutput {
    let score = 0;
    const reasons: string[] = [];

    if (input.isFirstTimeRecipient) {
      score += 30;
      reasons.push('first_time_recipient');
    }

    if (input.amount >= 1000) {
      score += 30;
      reasons.push('amount_above_1000');
    } else if (input.amount >= 500) {
      score += 15;
      reasons.push('amount_above_500');
    }

    const handle = input.recipientHandle.toLowerCase();
    if (/(crypto|binance|luno|tokenize|bitcoin|wallet)/.test(handle)) {
      score += 40;
      reasons.push('crypto_destination');
    }
    if (/unknown|untrusted/.test(handle)) {
      score += 20;
      reasons.push('untrusted_recipient');
    }

    const decision: 'PASS' | 'HOLD' = score >= MED_RISK ? 'HOLD' : 'PASS';
    this.logger.log(`Risk evaluated: score=${score} decision=${decision} reasons=[${reasons.join(',')}]`);
    return { decision, score, reasons };
  }
}
