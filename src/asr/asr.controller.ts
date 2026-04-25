import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { AsrService } from './asr.service';

@ApiExcludeController()
@Controller('audio')
export class AsrController {
  constructor(private readonly asr: AsrService) {}

  @Get(':id')
  serve(@Param('id') id: string, @Res() res: Response) {
    const item = this.asr.get(id);
    if (!item) {
      res.status(404).send('not found');
      return;
    }
    res.setHeader('Content-Type', item.mime);
    res.setHeader('Content-Length', item.bytes.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(item.bytes);
  }
}
