import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { IncidentStatus } from '../entities/incident-report.entity';

export class UpdateIncidentDto {
  @ApiProperty({ example: '2025-01-15T10:30:00Z', required: false })
  @IsDateString()
  @IsOptional()
  incidentDate?: string;

  @ApiProperty({ example: 'Playground', required: false })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiProperty({ example: 'Updated description', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'Applied ice pack and monitored', required: false })
  @IsString()
  @IsOptional()
  actionTaken?: string;

  @ApiProperty({ example: ['John Doe'], required: false, type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  witnesses?: string[];

  @ApiProperty({ example: ['https://s3.../photo1.jpg'], required: false, type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photoUrls?: string[];

  @ApiProperty({ enum: IncidentStatus, required: false })
  @IsEnum(IncidentStatus)
  @IsOptional()
  status?: IncidentStatus;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  parentAcknowledged?: boolean;
}







