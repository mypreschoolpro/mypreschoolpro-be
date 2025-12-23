import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID, IsObject, ValidateNested, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

class LocationDto {
  @ApiProperty({ example: 40.7128 })
  @IsNotEmpty()
  lat: number;

  @ApiProperty({ example: -74.0060 })
  @IsNotEmpty()
  lng: number;

  @ApiProperty({ example: 10, required: false })
  @IsOptional()
  accuracy?: number;
}

export class CheckInDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  studentId: string;

  @ApiProperty({ example: 'data:image/png;base64,iVBORw0KGgoAAAANS...' })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({ type: LocationDto })
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  location: LocationDto;

  @ApiProperty({ example: 'Optional notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ example: false, required: false })
  @IsBoolean()
  @IsOptional()
  isAuthorizedPickup?: boolean;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', required: false })
  @IsUUID()
  @IsOptional()
  authorizedPickupId?: string;
}







