import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { TwilioModule } from './twilio/twilio.module';
import { VoiceModule } from './voice/voice.module';
import { RiskModule } from './risk/risk.module';
import { FamiliesModule } from './families/families.module';
import { GuardianshipsModule } from './guardianships/guardianships.module';
import { BudgetsModule } from './budgets/budgets.module';
import { ChatModule } from './chat/chat.module';
import { TransactionsModule } from './transactions/transactions.module';
import { InterventionsModule } from './interventions/interventions.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SimulatorModule } from './simulator/simulator.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    MeModule,
    RiskModule,
    FamiliesModule,
    GuardianshipsModule,
    BudgetsModule,
    ChatModule,
    TwilioModule,
    TransactionsModule,
    VoiceModule,
    InterventionsModule,
    WebhooksModule,
    SimulatorModule,
  ],
})
export class AppModule {}
