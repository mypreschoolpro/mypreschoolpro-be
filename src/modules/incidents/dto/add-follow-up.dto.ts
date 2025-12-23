import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AddFollowUpDto {
  @ApiProperty({ example: 'Follow-up note about the incident' })
  @IsString()
  @IsNotEmpty()
  note: string;
}







