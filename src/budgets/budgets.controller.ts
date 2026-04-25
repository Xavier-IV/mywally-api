import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { BudgetPeriod } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { BudgetsService } from './budgets.service';

export class BudgetDto {
  @ApiProperty({ example: 100, description: 'Budget cap in major units (RM)' })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: BudgetPeriod, example: BudgetPeriod.DAILY })
  @IsEnum(BudgetPeriod)
  period!: BudgetPeriod;

  @ApiProperty({ example: 80, description: 'Alert when this % of the budget is reached (20-100)' })
  @IsInt()
  @Min(20)
  @Max(100)
  warningThresholdPercent!: number;

  @ApiProperty({
    example: 50,
    required: false,
    description: 'Amount up to which transactions auto-approve without alerts (RM)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyAutoApproveLimit?: number;
}

@ApiTags('budgets')
@Controller('families/:familyId/budget')
export class BudgetsController {
  constructor(private readonly svc: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'Get the family budget' })
  get(@Param('familyId') familyId: string) {
    return this.svc.findByFamilyId(familyId);
  }

  @Put()
  @ApiOperation({ summary: 'Replace the family budget (idempotent)' })
  put(@Param('familyId') familyId: string, @Body() dto: BudgetDto) {
    return this.svc.upsertForFamilyId(familyId, dto);
  }
}
