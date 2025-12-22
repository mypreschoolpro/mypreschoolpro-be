import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './entities/message.entity';
import { NotificationTemplate } from './entities/notification-template.entity';
import { Notification } from './entities/notification.entity';
import { ParentMessage } from './entities/parent-message.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { ProfileEntity } from '../users/entities/profile.entity';
import { UserRoleEntity } from '../users/entities/user-role.entity';
import { EnrollmentEntity } from '../enrollment/entities/enrollment.entity';
import { LeadEntity } from '../leads/entities/lead.entity';
import { ClassEntity } from '../classes/entities/class.entity';
import { SchoolEntity } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationsService } from './communications.service';
import { CommunicationsController } from './communications.controller';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationTemplateController } from './notification-template.controller';
import { PaymentReminderService } from './payment-reminder.service';
import { SystemNotificationService } from './system-notification.service';
import { SystemNotificationController } from './system-notification.controller';
import { MailerModule } from '../mailer/mailer.module';
import { MediaModule } from '../media/media.module';
import { LeadActivity } from '../leads/entities/lead-activity.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      NotificationTemplate,
      Notification,
      ParentMessage,
      PushSubscription,
      NotificationPreference,
      ProfileEntity,
      UserRoleEntity,
      EnrollmentEntity,
      LeadEntity,
      LeadActivity,
      ClassEntity,
      SchoolEntity,
      Student,
    ]),
    MailerModule,
    MediaModule,
  ],
  controllers: [
    CommunicationsController,
    NotificationTemplateController,
    SystemNotificationController,
  ],
  providers: [
    CommunicationsService,
    NotificationTemplateService,
    PaymentReminderService,
    SystemNotificationService,
  ],
  exports: [
    CommunicationsService,
    NotificationTemplateService,
    PaymentReminderService,
    SystemNotificationService,
  ],
})
export class CommunicationsModule { }

