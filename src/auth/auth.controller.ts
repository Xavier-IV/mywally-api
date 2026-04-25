import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { AuthService } from './auth.service';

class IssueTokenDto {
  @ApiProperty({ description: 'User to mint a token for' })
  @IsString()
  userId!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('tokens')
  @ApiOperation({
    summary: 'Issue a JWT for a user (dev backdoor for hackathon)',
    description:
      'No password is checked. Production must replace this with a proper login flow ' +
      '(magic link, OTP, or TNG SSO). The /sim UI uses this to hand out tokens to colleagues.',
  })
  async issue(@Body() dto: IssueTokenDto) {
    const { token, user } = await this.auth.issueTokenForUserId(dto.userId);
    return {
      token,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        role: user.role,
        fullName: user.fullName,
        phone: user.phone,
      },
    };
  }
}
