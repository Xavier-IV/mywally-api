import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { GuardianshipsService } from './guardianships.service';

class UpdateGuardianshipDto {
  @ApiProperty({ required: false, example: 'Daughter' })
  @IsOptional()
  @IsString()
  relationshipLabel?: string;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  canViewBalance?: boolean;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  canViewTransactions?: boolean;

  @ApiProperty({ required: false, example: true })
  @IsOptional()
  @IsBoolean()
  canReceiveAlerts?: boolean;
}

@ApiTags('guardianships')
@Controller('guardianships')
export class GuardianshipsController {
  constructor(private readonly svc: GuardianshipsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get one guardianship (with guardian + permissions)' })
  async findOne(@Param('id') id: string) {
    const g = await this.svc.findById(id);
    return this.svc.serialize(g);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update guardianship fields (relationship label, permissions)',
    description: 'Backs the "Manage Permissions" flow.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateGuardianshipDto) {
    await this.svc.update(id, dto);
    const g = await this.svc.findById(id);
    return this.svc.serialize(g);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Revoke guardianship (soft delete)',
    description:
      'Sets status to REVOKED and stamps sunsetAt. Backs the "Remove Access" button. ' +
      'Audit log is preserved; the row is not actually deleted.',
  })
  async revoke(@Param('id') id: string) {
    await this.svc.revoke(id);
    const g = await this.svc.findById(id);
    return this.svc.serialize(g);
  }
}
