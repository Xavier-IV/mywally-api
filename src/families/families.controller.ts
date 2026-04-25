import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { FamiliesService } from './families.service';
import { normalizePhoneMY } from '../common/phone';

class CreateFamilyDto {
  @ApiProperty({ example: 'Encik Rahmat', description: 'Parent display name (spoken in voice call)' })
  @IsString()
  parentName!: string;

  @ApiProperty({ example: 'Nur Radhiah' })
  @IsString()
  guardianName!: string;

  @ApiProperty({ example: '+60138155761', description: 'Accepts E.164 (+60...) or Malaysian local (0138155761). Normalized server-side.' })
  @IsString()
  guardianPhone!: string;

  @ApiProperty({ required: false, example: 'Daughter' })
  @IsOptional()
  @IsString()
  relationshipLabel?: string;

  @ApiProperty({ required: false, example: '+60123456789' })
  @IsOptional()
  @IsString()
  parentPhone?: string;
}

@ApiTags('families')
@Controller('families')
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a family with one guardian',
    description: 'Bootstraps a parent user, a guardian user (or reuses if phone exists), and links them via Guardianship.',
  })
  async create(@Body() dto: CreateFamilyDto) {
    const guardianPhone = normalizePhoneMY(dto.guardianPhone);
    if (!guardianPhone) {
      throw new BadRequestException(`Invalid guardianPhone "${dto.guardianPhone}". Use +60... or 01...`);
    }
    const parentPhone = dto.parentPhone ? normalizePhoneMY(dto.parentPhone) ?? undefined : undefined;
    if (dto.parentPhone && !parentPhone) {
      throw new BadRequestException(`Invalid parentPhone "${dto.parentPhone}". Use +60... or 01...`);
    }
    const family = await this.families.create({ ...dto, guardianPhone, parentPhone });
    const gship = family.guardianships[0];
    return {
      familyId: family.id,
      parent: {
        id: family.parent.id,
        fullName: family.parent.fullName,
        phone: family.parent.phone,
      },
      guardian: {
        id: gship.guardian.id,
        fullName: gship.guardian.fullName,
        phone: gship.guardian.phone,
        relationshipLabel: gship.relationshipLabel,
      },
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all families' })
  list() {
    return this.families.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one family' })
  findOne(@Param('id') id: string) {
    return this.families.findById(id);
  }
}
