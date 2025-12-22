import { ApiProperty } from '@nestjs/swagger';
import { MessageType } from '../entities/message.entity';

export class MessageResponseDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    senderId: string;

    @ApiProperty()
    recipientId: string;

    @ApiProperty({ required: false, nullable: true })
    studentId: string | null;

    @ApiProperty()
    subject: string;

    @ApiProperty()
    content: string;

    @ApiProperty({ enum: MessageType })
    messageType: MessageType;

    @ApiProperty()
    isRead: boolean;

    @ApiProperty({ required: false, nullable: true })
    readAt: string | null;

    @ApiProperty()
    createdAt: string;

    @ApiProperty({ required: false, nullable: true })
    senderName?: string;

    @ApiProperty({ required: false, nullable: true })
    studentName?: string;
}
