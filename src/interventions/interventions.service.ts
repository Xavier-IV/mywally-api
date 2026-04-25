import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionsService } from '../transactions/transactions.service';
import { TwilioService } from '../twilio/twilio.service';

@Injectable()
export class InterventionsService {
  private readonly logger = new Logger(InterventionsService.name);

  constructor(
    private readonly txns: TransactionsService,
    private readonly twilio: TwilioService,
    private readonly config: ConfigService,
  ) {}

  async startGuardianCall(txId: string) {
    const tx = await this.txns.findById(txId);
    if (!tx) throw new Error(`tx ${txId} not found`);
    const guardianship = tx.family.guardianships.find((g) => g.status === 'ACTIVE');
    if (!guardianship) {
      this.logger.warn(`No active guardian for family ${tx.familyId}`);
      return;
    }
    const baseUrl = this.config.get<string>('PUBLIC_BASE_URL') ?? '';
    const url = `${baseUrl}/voice/answer?txId=${encodeURIComponent(txId)}`;
    const result = await this.twilio.placeCallWithUrl(guardianship.guardian.phone, url);
    await this.txns.markCalling(txId, result.sid);
    this.logger.log(`Started call ${result.sid} for tx ${txId} -> ${guardianship.guardian.phone}`);
    return result;
  }
}
