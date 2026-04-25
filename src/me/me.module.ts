import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { GuardianshipsModule } from '../guardianships/guardianships.module';
import { MeController } from './me.controller';

@Module({
  imports: [AuthModule, BudgetsModule, GuardianshipsModule],
  controllers: [MeController],
})
export class MeModule {}
