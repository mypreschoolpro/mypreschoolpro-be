import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsEnum, MaxLength, IsIn } from 'class-validator';
import { ParentMessageType } from '../entities/parent-message.entity';

export class SendParentMessageDto {
  @ApiProperty({
    description: 'Parent user ID (recipient) - required if recipientEmail is not provided',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  recipientId?: string;

  @ApiProperty({
    description: 'Parent email address (recipient) - required if recipientId is not provided',
    example: 'parent@example.com',
    required: false,
  })
  @IsString()
  @IsOptional()
  recipientEmail?: string;

  @ApiProperty({
    description: 'Student/Lead ID (optional)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  studentId?: string;

  @ApiProperty({
    description: 'Message subject',
    example: 'Update on John\'s progress',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  subject: string;

  @ApiProperty({
    description: 'Message content',
    example: 'I wanted to let you know that John has been doing great in class...',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: 'Message type',
    enum: ParentMessageType,
    example: ParentMessageType.GENERAL,
    default: ParentMessageType.GENERAL,
  })
  @IsEnum(ParentMessageType)
  @IsOptional()
  messageType?: ParentMessageType;

  @ApiProperty({
    description: 'Delivery channel',
    enum: ['email', 'sms'],
    default: 'email',
    required: false,
  })
  @IsString()
  @IsOptional()
  @IsIn(['email', 'sms'])
  channel?: 'email' | 'sms';
}

