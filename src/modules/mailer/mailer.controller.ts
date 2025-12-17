import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { MailerService } from './mailer.service';
import { SendEmailDto } from './dto/send-email.dto';
import { SendWelcomeEmailDto } from './dto/welcome-email.dto';
import { SendStaffInvitationDto } from './dto/staff-invitation.dto';
import { SendPaymentEmailDto } from './dto/payment-email.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
// import { UserResponseDto } from './dto/user-response.dto';
import { AppRole } from '../../common/enums/app-role.enum';

@ApiTags('Mailer')
@Controller('mailer')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MailerController {
  private readonly logger = new Logger(MailerController.name);

  constructor(private mailerService: MailerService) {}

  @Post('send')
  @ApiOperation({
    summary: 'Send generic email',
    description: 'Send a custom email with HTML content. Supports user preference checking and email logging.',
  })
  @ApiResponse({
    status: 201,
    description: 'Email sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        emailId: { type: 'string', example: 're_abc123xyz' },
        skipped: { type: 'boolean', example: false },
        reason: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid email data',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  @ApiInternalServerErrorResponse({
    description: 'Email service error',
  })
  async sendEmail(
    @Body() dto: SendEmailDto,
    @CurrentUser() user: AuthUser,
  ) {
    this.logger.log(`User ${user.email} sending email to ${Array.isArray(dto.to) ? dto.to.join(', ') : dto.to}`);

    // Use current user ID if not provided
    const userId = dto.userId || user.id;

    const result = await this.mailerService.sendEmail({
      to: dto.to,
      subject: dto.subject,
      html: dto.html,
      emailType: dto.emailType ? String(dto.emailType) : undefined,
      userId,
      schoolId: dto.schoolId || user.schoolId || undefined,
      metadata: dto.metadata,
      replyTo: dto.replyTo,
      cc: dto.cc,
      bcc: dto.bcc,
    });

    return {
      success: result.success,
      emailId: result.emailId,
      skipped: result.skipped,
      reason: result.reason,
    };
  }

  @Post('welcome')
  @ApiOperation({
    summary: 'Send welcome email',
    description: 'Send a role-specific welcome email to new users (parent, teacher, admin, etc.).',
  })
  @ApiResponse({
    status: 201,
    description: 'Welcome email sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        emailId: { type: 'string', example: 're_abc123xyz' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid welcome email data',
  })
  async sendWelcomeEmail(@Body() dto: SendWelcomeEmailDto) {
    this.logger.log(`Sending welcome email to ${dto.userEmail} (role: ${dto.userRole})`);

    const result = await this.mailerService.sendWelcomeEmail({
      userEmail: dto.userEmail,
      userName: dto.userName,
      userRole: dto.userRole,
      schoolName: dto.schoolName,
      schoolId: dto.schoolId,
    });

    return {
      success: result.success,
      emailId: result.emailId,
    };
  }

  @Post('staff-invitation')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.SCHOOL_OWNER)
  @ApiOperation({
    summary: 'Send staff invitation',
    description: 'Send a staff invitation email with invitation link. Admin only.',
  })
  @ApiResponse({
    status: 201,
    description: 'Staff invitation sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        emailId: { type: 'string', example: 're_abc123xyz' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid invitation data',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async sendStaffInvitation(@Body() dto: SendStaffInvitationDto) {
    this.logger.log(`Sending staff invitation to ${dto.email} (role: ${dto.role})`);

    const result = await this.mailerService.sendStaffInvitation({
      schoolId: dto.schoolId,
      email: dto.email,
      role: dto.role,
      schoolName: dto.schoolName,
      invitedBy: dto.invitedBy,
      invitationToken: dto.invitationToken,
      invitationLink: dto.invitationLink,
    });

    return {
      success: result.success,
      emailId: result.emailId,
    };
  }

  @Public()
  @Post('payment/public')
  @ApiOperation({
    summary: 'Send payment confirmation email (public)',
    description: 'Send payment confirmation emails for public forms (e.g., waitlist payments). No authentication required.',
  })
  @ApiResponse({
    status: 201,
    description: 'Payment email sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        emailId: { type: 'string', example: 're_abc123xyz' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid payment email data',
  })
  async sendPublicPaymentEmail(@Body() dto: SendPaymentEmailDto) {
    this.logger.log(`Sending public payment email (${dto.type}) to ${dto.recipientEmail}`);

    const result = await this.mailerService.sendPaymentEmail({
      type: dto.type,
      recipientEmail: dto.recipientEmail,
      recipientName: dto.recipientName,
      schoolName: dto.schoolName,
      amount: dto.amount,
      currency: dto.currency,
      invoiceNumber: dto.invoiceNumber,
      dueDate: dto.dueDate,
      paymentDate: dto.paymentDate,
      paymentUrl: dto.paymentUrl,
      userId: dto.userId,
      schoolId: dto.schoolId,
      metadata: dto.metadata,
    });

    return {
      success: result.success,
      emailId: result.emailId,
    };
  }

  @Post('payment')
  @ApiOperation({
    summary: 'Send payment email',
    description: 'Send payment-related emails (invoice, confirmation, reminder, failure).',
  })
  @ApiResponse({
    status: 201,
    description: 'Payment email sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        emailId: { type: 'string', example: 're_abc123xyz' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid payment email data',
  })
  async sendPaymentEmail(@Body() dto: SendPaymentEmailDto) {
    this.logger.log(`Sending payment email (${dto.type}) to ${dto.recipientEmail}`);

    const result = await this.mailerService.sendPaymentEmail({
      type: dto.type,
      recipientEmail: dto.recipientEmail,
      recipientName: dto.recipientName,
      schoolName: dto.schoolName,
      amount: dto.amount,
      currency: dto.currency,
      invoiceNumber: dto.invoiceNumber,
      dueDate: dto.dueDate,
      paymentDate: dto.paymentDate,
      paymentUrl: dto.paymentUrl,
      userId: dto.userId,
      schoolId: dto.schoolId,
      metadata: dto.metadata,
    });

    return {
      success: result.success,
      emailId: result.emailId,
    };
  }

  @Post('bulk')
  @Roles(AppRole.SUPER_ADMIN, AppRole.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Send bulk emails',
    description: 'Send emails to multiple recipients in batches. Rate-limited for API protection. Admin only.',
  })
  @ApiResponse({
    status: 201,
    description: 'Bulk email sending initiated',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        sent: { type: 'number', example: 95 },
        failed: { type: 'number', example: 5 },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid bulk email data',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async sendBulkEmails(
    @Body()
    dto: {
      recipients: string[];
      subject: string;
      html: string;
      emailType: string;
    },
  ) {
    this.logger.log(`Sending bulk email to ${dto.recipients.length} recipients`);

    const result = await this.mailerService.sendBulkEmails(
      dto.recipients,
      dto.subject,
      dto.html,
      dto.emailType,
    );

    return {
      success: result.success,
      sent: result.sent,
      failed: result.failed,
    };
  }
}

