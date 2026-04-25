import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { InterventionsModule } from '../interventions/interventions.module';
import { TngWebhookController } from './tng.controller';

@Module({
  imports: [TransactionsModule, InterventionsModule],
  controllers: [TngWebhookController],
})
export class WebhooksModule {}
