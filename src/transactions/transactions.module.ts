import { forwardRef, Module } from '@nestjs/common';
import { RiskModule } from '../risk/risk.module';
import { InterventionsModule } from '../interventions/interventions.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [RiskModule, forwardRef(() => InterventionsModule)],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
