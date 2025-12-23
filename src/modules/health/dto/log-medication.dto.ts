import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsDateString,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { AdministrationStatus } from '../entities/medication-log.entity';

export class LogMedicationDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  authorizationId: string;

  @ApiProperty({ example: '2025-01-15T09:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  administrationTime: string;

  @ApiProperty({ example: '5ml' })
  @IsString()
  @IsNotEmpty()
  dosage: string;

  @ApiProperty({ example: 'Student took medication without issues', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ example: 'https://s3.../medication-photo.jpg', required: false })
  @IsString()
  @IsOptional()
  photoUrl?: string;

  @ApiProperty({ enum: AdministrationStatus, required: false })
  @IsEnum(AdministrationStatus)
  @IsOptional()
  status?: AdministrationStatus;
}







