import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { CommunicationsService } from './communications.service';
import { SendParentMessageDto } from './dto/send-parent-message.dto';
import { ParentMessageResponseDto } from './dto/parent-message-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { AppRole } from '../../common/enums/app-role.enum';

@ApiTags('Communications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('communications')
export class CommunicationsController {
  constructor(private readonly communicationsService: CommunicationsService) { }

  @Post('parent-messages')
  @Roles(AppRole.TEACHER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF, AppRole.SCHOOL_OWNER)
  @ApiOperation({
    summary: 'Send message to parent',
    description: 'Send a message from teacher/admin to a parent. Teachers can only message parents of students in their classes.',
  })
  @ApiResponse({
    status: 201,
    description: 'Message sent successfully',
    type: ParentMessageResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  async sendParentMessage(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendParentMessageDto,
  ): Promise<ParentMessageResponseDto> {
    return this.communicationsService.sendParentMessage(user.id, dto);
  }

  @Get('parent-messages')
  @Roles(AppRole.PARENT)
  @ApiOperation({
    summary: 'Get messages for parent',
    description: 'Retrieve all messages sent to the authenticated parent.',
  })
  @ApiResponse({
    status: 200,
    description: 'Messages retrieved successfully',
    type: [ParentMessageResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getParentMessages(@CurrentUser() user: AuthUser): Promise<ParentMessageResponseDto[]> {
    return this.communicationsService.getParentMessages(user.id);
  }

  @Get('teacher-messages')
  @Roles(AppRole.TEACHER, AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF, AppRole.SCHOOL_OWNER)
  @ApiOperation({
    summary: 'Get messages sent by teacher/admin',
    description: 'Retrieve all messages sent by the authenticated teacher/admin.',
  })
  @ApiResponse({
    status: 200,
    description: 'Messages retrieved successfully',
    type: [ParentMessageResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getTeacherMessages(@CurrentUser() user: AuthUser): Promise<ParentMessageResponseDto[]> {
    return this.communicationsService.getTeacherMessages(user.id);
  }

  @Patch('parent-messages/:id/read')
  @Roles(AppRole.PARENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark message as read',
    description: 'Mark a message as read by the authenticated parent.',
  })
  @ApiResponse({
    status: 204,
    description: 'Message marked as read',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - can only mark own messages as read' })
  async markAsRead(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.communicationsService.markAsRead(id, user.id);
  }

  @Get('messages')
  @Roles(AppRole.PARENT)
  @ApiOperation({
    summary: 'Get general messages for parent',
    description: 'Retrieve all general messages (not direct parent-teacher) sent to the authenticated parent.',
  })
  @ApiResponse({
    status: 200,
    description: 'Messages retrieved successfully',
    type: [MessageResponseDto],
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getMessages(@CurrentUser() user: AuthUser): Promise<MessageResponseDto[]> {
    return this.communicationsService.getMessages(user.id);
  }

  @Patch('messages/:id/read')
  @Roles(AppRole.PARENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark general message as read',
    description: 'Mark a general message as read by the authenticated parent.',
  })
  @ApiResponse({
    status: 204,
    description: 'Message marked as read',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - can only mark own messages as read' })
  async markMessageRead(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.communicationsService.markMessageRead(id, user.id);
  }
}

