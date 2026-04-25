import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';

@Injectable()
export class TwilioService implements OnModuleInit {
  private readonly logger = new Logger(TwilioService.name);
  private client: Twilio | null = null;
  private fromNumber!: string;
  private fakeMode = true;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.config.get<string>('TWILIO_FROM_NUMBER') ?? '';
    this.fakeMode = this.config.get<string>('DEMO_FAKE_VOICE') === 'true';

    if (!sid || !token) {
      this.logger.warn('Twilio creds missing - service will run in fake mode');
      this.fakeMode = true;
      return;
    }
    this.client = new Twilio(sid, token);
    this.logger.log(`Twilio ready (fakeMode=${this.fakeMode}, from=${this.fromNumber})`);
  }

  async placeCallWithTwiml(to: string, twiml: string): Promise<{ sid: string; faked: boolean }> {
    if (this.fakeMode || !this.client) {
      this.logger.log(`[FAKE CALL] to=${to}\nTwiML:\n${twiml}`);
      return { sid: `FAKE-${Date.now()}`, faked: true };
    }
    const call = await this.client.calls.create({
      to,
      from: this.fromNumber,
      twiml,
    });
    this.logger.log(`Placed call ${call.sid} to ${to}`);
    return { sid: call.sid, faked: false };
  }

  async placeCallWithUrl(to: string, url: string): Promise<{ sid: string; faked: boolean }> {
    if (this.fakeMode || !this.client) {
      this.logger.log(`[FAKE CALL] to=${to} url=${url}`);
      return { sid: `FAKE-${Date.now()}`, faked: true };
    }
    const call = await this.client.calls.create({ to, from: this.fromNumber, url });
    this.logger.log(`Placed call ${call.sid} to ${to}`);
    return { sid: call.sid, faked: false };
  }
}
