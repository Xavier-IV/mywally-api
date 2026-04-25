import { forwardRef, Module } from '@nestjs/common';
import { TwilioModule } from '../twilio/twilio.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { InterventionsService } from './interventions.service';

@Module({
  imports: [TwilioModule, forwardRef(() => TransactionsModule)],
  providers: [InterventionsService],
  exports: [InterventionsService],
})
export class InterventionsModule {}
