import { Global, Module } from '@nestjs/common';
import { AsrController } from './asr.controller';
import { AsrService } from './asr.service';

@Global()
@Module({
  controllers: [AsrController],
  providers: [AsrService],
  exports: [AsrService],
})
export class AsrModule {}
