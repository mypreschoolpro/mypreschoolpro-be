import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsArray,
  IsDateString,
  IsOptional,
  Matches,
} from 'class-validator';

export class CreateMedicationAuthorizationDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({ example: 'Tylenol' })
  @IsString()
  @IsNotEmpty()
  medicationName: string;

  @ApiProperty({ example: '5ml' })
  @IsString()
  @IsNotEmpty()
  dosage: string;

  @ApiProperty({ example: ['09:00', '14:00'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  @Matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, {
    each: true,
    message: 'Each time must be in HH:mm format',
  })
  @IsNotEmpty()
  administrationTimes: string[];

  @ApiProperty({ example: '2025-01-15' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ example: '2025-01-30', required: false })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiProperty({ example: 'Take with food', required: false })
  @IsString()
  @IsOptional()
  specialInstructions?: string;

  @ApiProperty({ example: 'https://s3.../doctor-note.pdf', required: false })
  @IsString()
  @IsOptional()
  doctorNoteUrl?: string;

  @ApiProperty({ example: 'https://s3.../prescription.pdf', required: false })
  @IsString()
  @IsOptional()
  prescriptionUrl?: string;
}







