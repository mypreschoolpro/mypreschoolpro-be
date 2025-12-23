import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsArray,
  IsDateString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

export class CreateIllnessLogDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({ example: '2025-01-15T10:30:00Z' })
  @IsDateString()
  @IsNotEmpty()
  illnessDate: string;

  @ApiProperty({ example: ['fever', 'cough', 'runny_nose'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  symptoms: string[];

  @ApiProperty({ example: 98.6, required: false, minimum: 90, maximum: 110 })
  @IsNumber()
  @Min(90)
  @Max(110)
  @IsOptional()
  temperature?: number;

  @ApiProperty({ example: 'Student appears tired and has been coughing', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ example: false, required: false })
  @IsBoolean()
  @IsOptional()
  pickupRecommended?: boolean;

  @ApiProperty({ example: 'https://s3.../doctor-note.pdf', required: false })
  @IsString()
  @IsOptional()
  doctorNoteUrl?: string;
}







