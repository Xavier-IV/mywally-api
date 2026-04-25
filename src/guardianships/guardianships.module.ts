import { Module } from '@nestjs/common';
import { GuardianshipsController } from './guardianships.controller';
import { GuardianshipsService } from './guardianships.service';

@Module({
  controllers: [GuardianshipsController],
  providers: [GuardianshipsService],
  exports: [GuardianshipsService],
})
export class GuardianshipsModule {}
