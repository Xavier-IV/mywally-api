import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

@ApiTags('chat')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard)
@Controller('me/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

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
}
