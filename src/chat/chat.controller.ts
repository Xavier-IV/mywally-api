import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AsrService } from '../asr/asr.service';
import { ChatService } from './chat.service';

class HistoryItemDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  content!: string;
}

class ChatMessageDto {
  @ApiProperty({ example: 'I want to add my daughter Nur Radhiah, her phone is +60123456789' })
  @IsString()
  text!: string;

  @ApiProperty({
    required: false,
    type: [HistoryItemDto],
    description: 'Conversation history maintained client-side (stateless server).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => HistoryItemDto)
  history?: HistoryItemDto[];
}

class VoiceMessageDto {
  @ApiProperty({ description: 'base64-encoded audio (no data: prefix)' })
  @IsString()
  audio!: string;

  @ApiProperty({ example: 'audio/webm;codecs=opus', description: 'MIME type of the recorded audio' })
  @IsString()
  mime!: string;

  @ApiProperty({ required: false, type: [HistoryItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => HistoryItemDto)
  history?: HistoryItemDto[];
}

@ApiTags('chat')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('me/chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly asr: AsrService,
  ) {}

  @Get('tools')
  @ApiOperation({
    summary: 'List chat tools available to the current user',
    description:
      'Returned tools are filtered by role and (for guardians) by Guardianship.permissions. ' +
      'FE can render quick-action buttons from this list.',
  })
  async tools(@CurrentUser() user: User) {
    return { tools: await this.chat.toolsForUser(user) };
  }

  @Post('messages')
  @ApiOperation({
    summary: 'Send a message to the chatbot, get assistant reply + structured actions',
    description:
      'Stateless. FE keeps the conversation history and replays it on each call. ' +
      'Response includes the assistant text plus an `actions` array (what tools ran, with results) ' +
      'and a `ui` array (toast/navigate/refresh hints for the FE).',
  })
  async send(@CurrentUser() user: User, @Body() dto: ChatMessageDto) {
    return this.chat.handleMessage(user, { text: dto.text, history: dto.history });
  }

  @Post('messages/voice')
  @ApiOperation({
    summary: 'Send a voice note to the chatbot',
    description:
      'Audio is uploaded as base64 in JSON. Server transcribes via Alibaba qwen3-asr-flash, ' +
      'then runs the transcript through the same chat pipeline. Returns the transcript ' +
      '(so the FE can render it as a user message bubble) plus the standard chat response.',
  })
  async sendVoice(@CurrentUser() user: User, @Body() dto: VoiceMessageDto) {
    const bytes = Buffer.from(dto.audio, 'base64');
    const { transcript, error, raw } = await this.asr.transcribe(bytes, dto.mime);
    if (!transcript) {
      return {
        transcript: null,
        reply: { role: 'assistant', text: 'Sorry, I could not hear that clearly. Try again?' },
        actions: [],
        ui: [],
        asrError: error,
        asrRaw: raw,
      };
    }
    const chat = await this.chat.handleMessage(user, { text: transcript, history: dto.history });
    return { transcript, ...chat };
  }
}
