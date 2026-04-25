import { Module } from '@nestjs/common';
import { TwilioModule } from '../twilio/twilio.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { VoiceController } from './voice.controller';

@Module({
  imports: [TwilioModule, TransactionsModule],
  controllers: [VoiceController],
})
export class VoiceModule {}
