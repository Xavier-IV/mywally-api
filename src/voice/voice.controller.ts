import {
  Body,
  Controller,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { twiml as TwiMLBuilders } from 'twilio';
import { DecisionAction, DecisionChannel } from '@prisma/client';
import { TwilioService } from '../twilio/twilio.service';
import { TransactionsService } from '../transactions/transactions.service';

const { VoiceResponse } = TwiMLBuilders;

const DEMO_PIN = '1234';
const DEMO_PARENT_FALLBACK = 'your family member';
const DEMO_AMOUNT_FALLBACK = 'one thousand five hundred ringgit';
const DEMO_RECIPIENT_FALLBACK = 'an unfamiliar account';

class TestCallDto {
  @ApiProperty({ example: '+60138155761', description: 'E.164 phone number to call' })
  @IsString()
  to!: string;

  @ApiProperty({ required: false, description: 'Existing transaction id to bind to (otherwise demo mode)' })
  @IsOptional()
  @IsString()
  txId?: string;
}

@ApiTags('voice')
@Controller('voice')
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);

  constructor(
    private readonly twilio: TwilioService,
    private readonly config: ConfigService,
    private readonly txns: TransactionsService,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('PUBLIC_BASE_URL') ?? 'http://localhost:3000';
  }

  @Post('test-call')
  @ApiOperation({
    summary: 'Place a manual outbound call (demo / debug only)',
    description: 'Places an outbound Twilio call that lands on /voice/answer. Used for ringing your own phone during development without going through the full TNG webhook + risk flow.',
  })
  async testCall(@Body() dto: TestCallDto) {
    const txId = dto.txId ?? `demo-${Date.now()}`;
    const url = `${this.baseUrl}/voice/answer?txId=${encodeURIComponent(txId)}`;
    const result = await this.twilio.placeCallWithUrl(dto.to, url);
    return {
      ok: true,
      ...result,
      to: dto.to,
      txId,
      url,
      hint: result.faked
        ? 'DEMO_FAKE_VOICE=true in .env, no real call placed.'
        : 'Real call placed - your phone should ring.',
    };
  }

  @Post('answer')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  answer(@Query('txId') txId = '', @Body() body: Record<string, unknown>) {
    this.logger.log(`/answer txId=${txId} CallSid=${body.CallSid ?? ''}`);
    const twiml = new VoiceResponse();
    const action = `${this.baseUrl}/voice/pin?txId=${encodeURIComponent(txId)}&attempts=0`;
    const gather = twiml.gather({
      input: ['dtmf'],
      numDigits: 4,
      timeout: 8,
      finishOnKey: '#',
      action,
      method: 'POST',
    });
    gather.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Hi, this is myWally. There is an urgent confirmation request. To continue, please enter your four digit pin, followed by the pound key.',
    );
    twiml.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'We did not receive your pin. Goodbye.',
    );
    twiml.hangup();
    return twiml.toString();
  }

  @Post('pin')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async pin(
    @Query('txId') txId = '',
    @Query('attempts') attemptsStr = '0',
    @Body() body: Record<string, unknown>,
  ) {
    const digits = String(body.Digits ?? '');
    const attempts = parseInt(attemptsStr, 10) || 0;
    const valid = digits === DEMO_PIN;
    this.logger.log(`/pin txId=${txId} digits=${digits} attempt=${attempts + 1} valid=${valid}`);

    const twiml = new VoiceResponse();

    if (!valid) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= 3) {
        twiml.say(
          { voice: 'Polly.Joanna', language: 'en-US' },
          'Too many incorrect attempts. For your security, this call will end now. Goodbye.',
        );
        twiml.hangup();
        return twiml.toString();
      }
      const action = `${this.baseUrl}/voice/pin?txId=${encodeURIComponent(txId)}&attempts=${nextAttempts}`;
      const gather = twiml.gather({
        input: ['dtmf'],
        numDigits: 4,
        timeout: 8,
        finishOnKey: '#',
        action,
        method: 'POST',
      });
      gather.say(
        { voice: 'Polly.Joanna', language: 'en-US' },
        'Incorrect pin. Please try again.',
      );
      twiml.hangup();
      return twiml.toString();
    }

    // PIN OK - disclose transaction
    let parentName = DEMO_PARENT_FALLBACK;
    let amountSpeech = DEMO_AMOUNT_FALLBACK;
    let recipientSpeech = DEMO_RECIPIENT_FALLBACK;
    const tx = await this.txns.findById(txId).catch(() => null);
    if (tx) {
      parentName = tx.family.parent.fullName;
      amountSpeech = `${tx.amount.toString()} ${tx.currency === 'MYR' ? 'ringgit' : tx.currency}`;
      recipientSpeech = tx.recipientName;
    }

    twiml.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Pin accepted. Please listen carefully.',
    );
    twiml.pause({ length: 1 });
    const action = `${this.baseUrl}/voice/decision?txId=${encodeURIComponent(txId)}`;
    const gather = twiml.gather({
      input: ['dtmf'],
      numDigits: 1,
      timeout: 15,
      finishOnKey: '',
      action,
      method: 'POST',
    });
    gather.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `${parentName} is requesting to send ${amountSpeech} to ${recipientSpeech}.`,
    );
    gather.pause({ length: 1 });
    gather.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'To approve, press 1. To reject and freeze the account, press 9. To call her now, press 5.',
    );
    twiml.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'We did not receive your choice. For safety, the transaction will be rejected. Goodbye.',
    );
    twiml.hangup();
    return twiml.toString();
  }

  @Post('decision')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async decision(@Query('txId') txId = '', @Body() body: Record<string, unknown>) {
    const digits = String(body.Digits ?? '');
    const callSid = String(body.CallSid ?? '');
    this.logger.log(`/decision txId=${txId} digits=${digits}`);

    const twiml = new VoiceResponse();
    let action: DecisionAction | null = null;
    switch (digits) {
      case '1':
        action = DecisionAction.APPROVE;
        twiml.say(
          { voice: 'Polly.Joanna', language: 'en-US' },
          'Approved. The transaction will go through. Thank you for keeping her safe. Goodbye.',
        );
        break;
      case '9':
        action = DecisionAction.REJECT;
        twiml.say(
          { voice: 'Polly.Joanna', language: 'en-US' },
          'Rejected. The transaction is blocked and the account is frozen for twenty four hours. Goodbye.',
        );
        break;
      case '5':
        action = DecisionAction.CALL_PARENT;
        twiml.say(
          { voice: 'Polly.Joanna', language: 'en-US' },
          'In production, we would now connect you to the parent. For this demo, the request is logged. Goodbye.',
        );
        break;
      default:
        action = DecisionAction.TIMEOUT;
        twiml.say(
          { voice: 'Polly.Joanna', language: 'en-US' },
          'No valid choice received. For safety, the transaction will be rejected. Goodbye.',
        );
    }
    twiml.hangup();

    this.logger.log(`DECISION ${action} tx=${txId}`);

    // Persist if this is a real tx
    const tx = await this.txns.findById(txId).catch(() => null);
    if (tx && action) {
      const guardian = tx.family.guardianships.find((g) => g.status === 'ACTIVE')?.guardian;
      if (guardian) {
        await this.txns.recordDecision(tx.id, guardian.id, action, DecisionChannel.VOICE, {
          dtmf: digits || undefined,
          twilioCallSid: callSid || undefined,
        });
      }
    }

    return twiml.toString();
  }
}
