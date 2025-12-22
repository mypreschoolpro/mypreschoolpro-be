import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Message, MessageType } from './entities/message.entity';
import { ParentMessage, ParentMessageType } from './entities/parent-message.entity';
import { MessageResponseDto } from './dto/message-response.dto';
import { SendParentMessageDto } from './dto/send-parent-message.dto';
import { ParentMessageResponseDto } from './dto/parent-message-response.dto';
import { ProfileEntity } from '../users/entities/profile.entity';
import { UserRoleEntity } from '../users/entities/user-role.entity';
import { EnrollmentEntity, EnrollmentStatus } from '../enrollment/entities/enrollment.entity';
import { LeadEntity } from '../leads/entities/lead.entity';
import { ClassEntity } from '../classes/entities/class.entity';
import { AppRole } from '../../common/enums/app-role.enum';
import { MailerService } from '../mailer/mailer.service';
import { LeadActivity } from '../leads/entities/lead-activity.entity';
import { Student } from '../students/entities/student.entity';

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    @InjectRepository(ParentMessage)
    private readonly parentMessageRepository: Repository<ParentMessage>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(ProfileEntity)
    private readonly profileRepository: Repository<ProfileEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepository: Repository<UserRoleEntity>,
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentRepository: Repository<EnrollmentEntity>,
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(ClassEntity)
    private readonly classRepository: Repository<ClassEntity>,
    @InjectRepository(LeadActivity)
    private readonly leadActivityRepository: Repository<LeadActivity>,
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    private readonly mailerService: MailerService,
  ) { }

  /**
   * Send message from teacher/admin to parent
   */
  async sendParentMessage(
    senderId: string,
    dto: SendParentMessageDto,
  ): Promise<ParentMessageResponseDto> {
    this.logger.log(`Sending message from ${senderId} to parent ${dto.recipientId}`);
    const channel = dto.channel || 'email';

    // 1. Validate sender is teacher/admin/staff
    const senderRole = await this.userRoleRepository.findOne({
      where: { userId: senderId },
      select: ['role', 'schoolId'],
    });

    if (!senderRole) {
      throw new NotFoundException('Sender role not found');
    }

    const senderRoleType = senderRole.role as AppRole;
    if (
      senderRoleType !== AppRole.TEACHER &&
      senderRoleType !== AppRole.SCHOOL_ADMIN &&
      senderRoleType !== AppRole.ADMISSIONS_STAFF &&
      senderRoleType !== AppRole.SCHOOL_OWNER
    ) {
      throw new ForbiddenException('Only teachers, school admins, and admissions staff can send messages to parents');
    }

    // 2. Validate recipient is a parent
    const recipientProfile = await this.profileRepository.findOne({
      where: { id: dto.recipientId },
      select: ['id', 'email', 'firstName', 'lastName'],
    });

    if (!recipientProfile) {
      throw new NotFoundException('Parent profile not found');
    }

    // Verify recipient is a parent
    const recipientRole = await this.userRoleRepository.findOne({
      where: { userId: dto.recipientId, role: AppRole.PARENT },
    });

    if (!recipientRole) {
      throw new BadRequestException('Recipient is not a parent');
    }

    // 3. Validate access based on role
    if (senderRoleType === AppRole.TEACHER) {
      // Teachers can only message parents of students in their classes
      if (dto.studentId) {
        // Verify student belongs to teacher's class using raw SQL for teacher_id
        const enrollmentResult = await this.enrollmentRepository.query(
          `SELECT e.id, e.lead_id, e.class_id, e.school_id, e.status
           FROM enrollment e
           INNER JOIN leads l ON l.id = e.lead_id
           INNER JOIN classes c ON c.id = e.class_id
           WHERE e.lead_id = $1
             AND e.status = $2
             AND c.teacher_id = $3
             AND LOWER(l.parent_email) = LOWER($4)
           LIMIT 1`,
          [dto.studentId, EnrollmentStatus.ACTIVE, senderId, recipientProfile.email],
        );

        const enrollment = enrollmentResult && enrollmentResult.length > 0 ? enrollmentResult[0] : null;

        if (!enrollment) {
          throw new ForbiddenException(
            'You can only message parents of students in your assigned classes',
          );
        }
      } else {
        // If no studentId, verify parent has at least one student in teacher's classes using raw SQL
        const enrollmentResult = await this.enrollmentRepository.query(
          `SELECT e.id, e.lead_id, e.class_id, e.school_id, e.status
           FROM enrollment e
           INNER JOIN leads l ON l.id = e.lead_id
           INNER JOIN classes c ON c.id = e.class_id
           WHERE c.teacher_id = $1
             AND e.status = $2
             AND LOWER(l.parent_email) = LOWER($3)
           LIMIT 1`,
          [senderId, EnrollmentStatus.ACTIVE, recipientProfile.email],
        );

        const enrollment = enrollmentResult && enrollmentResult.length > 0 ? enrollmentResult[0] : null;

        if (!enrollment) {
          throw new ForbiddenException(
            'You can only message parents of students in your assigned classes',
          );
        }
      }
    } else if (
      senderRoleType === AppRole.SCHOOL_ADMIN ||
      senderRoleType === AppRole.ADMISSIONS_STAFF ||
      senderRoleType === AppRole.SCHOOL_OWNER
    ) {
      // School staff can message parents of students in their school
      if (senderRole.schoolId) {
        const enrollment = await this.enrollmentRepository
          .createQueryBuilder('enrollment')
          .innerJoin('enrollment.lead', 'lead')
          .where('enrollment.school_id = :schoolId', { schoolId: senderRole.schoolId })
          .andWhere('enrollment.status = :status', { status: EnrollmentStatus.ACTIVE })
          .andWhere('lead.parent_email = :parentEmail', { parentEmail: recipientProfile.email })
          .getOne();

        if (!enrollment) {
          throw new ForbiddenException(
            'You can only message parents of students enrolled in your school',
          );
        }
      }
    }

    // 4. Get sender profile for email
    const senderProfile = await this.profileRepository.findOne({
      where: { id: senderId },
      select: ['id', 'firstName', 'lastName', 'email'],
    });

    if (!senderProfile) {
      throw new NotFoundException('Sender profile not found');
    }

    const senderName = `${senderProfile.firstName || ''} ${senderProfile.lastName || ''}`.trim() || 'Teacher';

    // 5. Create message
    // Note: parent_messages.student_id has a foreign key to students.id, but we're receiving lead_id
    // Since the column is nullable and RLS policies work with lead_id via enrollment joins,
    // we set studentId to null to avoid foreign key constraint violations
    const message = this.parentMessageRepository.create({
      teacherId: senderId,
      parentId: dto.recipientId,
      studentId: null, // Set to null since we have lead_id, not student_id. RLS policies handle lead_id via enrollment joins.
      subject: dto.subject,
      message: dto.content,
      messageType: dto.messageType || ParentMessageType.GENERAL,
      sentByTeacher: true,
      isRead: false,
    });

    const savedMessage = await this.parentMessageRepository.save(message);

    // 6. Send email notification
    try {
      const messageTypeLabel = this.getMessageTypeLabel(dto.messageType || ParentMessageType.GENERAL);

      await this.mailerService.sendEmail({
        to: recipientProfile.email,
        subject: `Message from ${senderName}: ${dto.subject}`,
        html: this.getEmailTemplate(senderName, dto.subject, dto.content, messageTypeLabel),
        emailType: 'parent_message',
        userId: dto.recipientId,
        schoolId: senderRole.schoolId || undefined,
        metadata: {
          messageId: savedMessage.id,
          messageType: dto.messageType || ParentMessageType.GENERAL,
          studentId: dto.studentId,
        },
      });

      this.logger.log(`Email notification sent to ${recipientProfile.email}`);
    } catch (error) {
      this.logger.error(`Failed to send email notification: ${error.message}`, error.stack);
      // Don't fail the request if email fails
    }

    if (dto.studentId) {
      try {
        const activityType = channel === 'sms' ? 'sms_sent' : 'email_sent';
        const notesPrefix = dto.subject ? `[${dto.subject}] ` : '';
        const activity = this.leadActivityRepository.create({
          leadId: dto.studentId,
          userId: senderId,
          activityType,
          notes: `${notesPrefix}${dto.content}`,
          metadata: {
            parentId: dto.recipientId,
            channel,
            messageId: savedMessage.id,
            messageType: dto.messageType || ParentMessageType.GENERAL,
          },
        });
        await this.leadActivityRepository.save(activity);
      } catch (activityError) {
        this.logger.warn(`Failed to log lead activity: ${(activityError as Error).message}`);
      }
    }

    // 7. Return response
    return {
      id: savedMessage.id,
      teacherId: savedMessage.teacherId,
      teacherName: senderName, // Defined earlier in the function
      parentId: savedMessage.parentId,
      studentId: savedMessage.studentId,
      subject: savedMessage.subject,
      message: savedMessage.message,
      isRead: savedMessage.isRead,
      sentByTeacher: savedMessage.sentByTeacher,
      messageType: savedMessage.messageType,
      createdAt: savedMessage.createdAt.toISOString(),
      readAt: null, // parent_messages table doesn't have read_at column
    };
  }

  /**
   * Get messages for a parent
   */
  async getParentMessages(parentId: string): Promise<ParentMessageResponseDto[]> {
    const messages = await this.parentMessageRepository.find({
      where: { parentId },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    // Get teacher profiles for all messages
    const teacherIds = [...new Set(messages.map((m) => m.teacherId))];
    const teacherProfiles = teacherIds.length > 0
      ? await this.profileRepository.find({
        where: { id: In(teacherIds) },
        select: ['id', 'firstName', 'lastName'],
      })
      : [];

    const teacherMap = new Map(
      teacherProfiles.map((p) => [
        p.id,
        `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Teacher',
      ]),
    );

    return messages.map((message) => ({
      id: message.id,
      teacherId: message.teacherId,
      teacherName: teacherMap.get(message.teacherId) || 'Teacher',
      parentId: message.parentId,
      studentId: message.studentId,
      subject: message.subject,
      message: message.message,
      isRead: message.isRead,
      sentByTeacher: message.sentByTeacher,
      messageType: message.messageType,
      createdAt: message.createdAt.toISOString(),
      readAt: null, // parent_messages table doesn't have read_at column
    }));
  }

  /**
   * Get messages sent by a teacher/admin
   */
  async getTeacherMessages(teacherId: string): Promise<ParentMessageResponseDto[]> {
    const messages = await this.parentMessageRepository.find({
      where: { teacherId },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    // Get parent profiles
    const parentIds = [...new Set(messages.map((m) => m.parentId))];
    const parentProfiles = parentIds.length > 0
      ? await this.profileRepository.find({
        where: { id: In(parentIds) },
        select: ['id', 'firstName', 'lastName'],
      })
      : [];

    const parentMap = new Map(
      parentProfiles.map((p) => [
        p.id,
        `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Parent',
      ]),
    );

    return messages.map((message) => ({
      id: message.id,
      teacherId: message.teacherId,
      teacherName: 'You',
      parentId: message.parentId,
      studentId: message.studentId,
      subject: message.subject,
      message: message.message,
      isRead: message.isRead,
      sentByTeacher: message.sentByTeacher,
      messageType: message.messageType,
      createdAt: message.createdAt.toISOString(),
      readAt: null, // parent_messages table doesn't have read_at column
    }));
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string, userId: string): Promise<void> {
    const message = await this.parentMessageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Only parent can mark as read
    if (message.parentId !== userId) {
      throw new ForbiddenException('You can only mark your own messages as read');
    }

    message.isRead = true;
    // Note: parent_messages table doesn't have read_at column, only is_read boolean
    await this.parentMessageRepository.save(message);
  }

  /**
   * Get message type label
   */
  private getMessageTypeLabel(type: ParentMessageType): string {
    const labels = {
      [ParentMessageType.GENERAL]: 'General Update',
      [ParentMessageType.PROGRESS]: 'Academic Progress',
      [ParentMessageType.BEHAVIOR]: 'Behavior Report',
      [ParentMessageType.ATTENDANCE]: 'Attendance Issue',
    };
    return labels[type] || 'Message';
  }

  /**
   * Get messages for a recipient (general messages)
   */
  async getMessages(recipientId: string): Promise<MessageResponseDto[]> {
    const messages = await this.messageRepository.find({
      where: { recipientId },
      order: { createdAt: 'DESC' },
      take: 50,
      relations: ['student'],
    });

    // Get sender profiles
    const senderIds = [...new Set(messages.map((m) => m.senderId))];
    const senderProfiles = senderIds.length > 0
      ? await this.profileRepository.find({
        where: { id: In(senderIds) },
        select: ['id', 'firstName', 'lastName'],
      })
      : [];

    const senderMap = new Map(
      senderProfiles.map((p) => [
        p.id,
        `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Staff',
      ]),
    );

    return messages.map((message) => ({
      id: message.id,
      senderId: message.senderId,
      senderName: senderMap.get(message.senderId) || 'Staff',
      recipientId: message.recipientId,
      studentId: message.studentId,
      studentName: message.student ? `${message.student.firstName} ${message.student.lastName}` : undefined,
      subject: message.subject,
      content: message.content,
      isRead: message.isRead,
      messageType: message.messageType,
      createdAt: message.createdAt.toISOString(),
      readAt: message.readAt ? message.readAt.toISOString() : null,
    }));
  }

  /**
   * Mark a general message as read
   */
  async markMessageRead(messageId: string, recipientId: string): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.recipientId !== recipientId) {
      throw new ForbiddenException('You can only mark your own messages as read');
    }

    message.isRead = true;
    message.readAt = new Date();
    await this.messageRepository.save(message);
  }

  /**
   * Get email template
   */
  private getEmailTemplate(
    senderName: string,
    subject: string,
    content: string,
    messageType: string,
  ): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0;">📧 New Message from Your Child's Teacher</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
          <h2 style="color: #333;">Hi there! 👋</h2>
          <p style="color: #666; line-height: 1.6;">You have received a new message from <strong>${senderName}</strong>.</p>
          
          <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
            <h3 style="color: #1e40af; margin-top: 0;">Message Details</h3>
            <p style="color: #666; margin: 5px 0;"><strong>From:</strong> ${senderName}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Type:</strong> ${messageType}</p>
            <p style="color: #666; margin: 5px 0;"><strong>Subject:</strong> ${subject}</p>
          </div>

          <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">Message:</h3>
            <p style="color: #333; line-height: 1.6; white-space: pre-wrap;">${content.replace(/\n/g, '<br>')}</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.APP_URL || 'http://localhost:5173'}/parent/messages" style="background-color: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
              View Message in Dashboard
            </a>
          </div>
          
          <p style="color: #666;">Please log in to your MyPreschoolPro dashboard to reply to this message.</p>
          <p style="color: #666;">Best regards,<br>The MyPreschoolPro Team</p>
        </div>
      </div>
    `;
  }
}

