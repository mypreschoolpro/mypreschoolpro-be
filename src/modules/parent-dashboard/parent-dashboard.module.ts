import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParentDashboardService } from './parent-dashboard.service';
import { ParentDashboardController } from './parent-dashboard.controller';
import { Waitlist } from '../enrollment/entities/waitlist.entity';
import { EnrollmentEntity } from '../enrollment/entities/enrollment.entity';
import { LeadInvoice } from '../leads/entities/lead-invoice.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Message } from '../communications/entities/message.entity';
import { ParentMessage } from '../communications/entities/parent-message.entity';
import { DailyReport } from '../teachers/entities/daily-report.entity';
import { Student } from '../students/entities/student.entity';
import { StudentProgress } from '../students/entities/student-progress.entity';
import { StudentAttendance } from '../students/entities/student-attendance.entity';
import { LeadEntity } from '../leads/entities/lead.entity';
import { LeadActivity } from '../leads/entities/lead-activity.entity';
import { Media } from '../media/entities/media.entity';
import { CheckInOutRecord } from '../checkinout/entities/check-in-out-record.entity';
import { ProfileEntity } from '../users/entities/profile.entity';
import { LeadsModule } from '../leads/leads.module';
import { TeachersModule } from '../teachers/teachers.module';

@Module({
  imports: [
    LeadsModule,
    TeachersModule,
    TypeOrmModule.forFeature([
      Waitlist,
      EnrollmentEntity,
      LeadInvoice,
      Invoice,
      Message,
      ParentMessage,
      DailyReport,
      Student,
      StudentProgress,
      StudentAttendance,
      LeadEntity,
      LeadActivity,
      Media,
      CheckInOutRecord,
      ProfileEntity,
    ]),
  ],
  controllers: [ParentDashboardController],
  providers: [ParentDashboardService],
})
export class ParentDashboardModule { }


