import { Body, Controller, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { TransactionsService } from '../transactions/transactions.service';
import { InterventionsService } from '../interventions/interventions.service';

class TngTransactionDto {
  @ApiProperty({ example: 'tng-tx-12345', description: 'TNG transaction reference (idempotency key)' })
  @IsString()
  externalRef!: string;

  @ApiProperty({ example: 'f8da5a29-40f7-4e54-bd7a-4d9b6164ab2d', description: 'myWally family id' })
  @IsString()
  familyId!: string;

  @ApiProperty({ example: 1500, description: 'Amount in major units (RM, not sen)' })
  @IsNumber()
  amount!: number;

  @ApiProperty({ example: 'MYR' })
  @IsString()
  currency!: string;

  @ApiProperty({ example: 'Unknown Maybank Account' })
  @IsString()
  recipientName!: string;

  @ApiProperty({ example: 'MAYBANK ****1234', description: 'Free text identifier shown to guardian' })
  @IsString()
  recipientHandle!: string;

  @ApiProperty({ required: false, example: 'transfer' })
  @IsOptional()
  @IsString()
  merchantCategory?: string;

  @ApiProperty({ example: true, description: 'TNG flag: parent has never paid this recipient before' })
  @IsBoolean()
  isFirstTimeRecipient!: boolean;
}

@ApiTags('webhooks')
@Controller('webhooks/tng')
export class TngWebhookController {
  private readonly logger = new Logger(TngWebhookController.name);

  constructor(
    private readonly txns: TransactionsService,
    private readonly interventions: InterventionsService,
  ) {}

  @Post('transaction')
  @ApiOperation({
    summary: 'TNG inbound: a new at-risk transaction',
    description:
      'TNG calls this when a payment is initiated for a parent in our system. ' +
      'We respond synchronously with the held state; the actual decision is delivered ' +
      'asynchronously via a separate callback to TNG once the guardian responds.',
  })
  async transaction(@Body() dto: TngTransactionDto) {
    this.logger.log(`TNG inbound: ${dto.externalRef} amount=${dto.amount} ${dto.currency}`);
    const tx = await this.txns.ingest(dto);

    if (tx.state === 'HELD') {
      this.interventions.startGuardianCall(tx.id).catch((err) => {
        this.logger.error(`Failed to start call for ${tx.id}: ${err.message}`);
      });
    }

    return {
      transactionId: tx.id,
      state: tx.state,
      riskScore: tx.riskScore,
      riskReasons: tx.riskReasons,
    };
  }
}
