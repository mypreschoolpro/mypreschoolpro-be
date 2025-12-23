import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { LeadsService } from '../leads/leads.service';
import { Waitlist } from '../enrollment/entities/waitlist.entity';
import { LeadInvoice } from '../leads/entities/lead-invoice.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Message } from '../communications/entities/message.entity';
import { ParentDashboardSummaryDto, ParentMessageDto, ParentPaymentDto, ParentWaitlistItemDto, ParentInvoiceDto } from './dto/parent-dashboard-summary.dto';
import {
  ParentChildActivityDto,
  ParentChildDto,
  ParentChildEnrollmentDto,
  ParentChildProgressDto,
  ParentDailyReportDto,
  SendParentMessageDto,
  ParentAttendanceDto,
  ParentProgressDto,
  ParentMediaDto,
  ParentReportsQueryDto,
  ParentReportsResponseDto,
} from './dto/parent-children.dto';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { PaymentStatus } from '../../common/enums/payment-status.enum';
import { LeadEntity, LeadStatus } from '../leads/entities/lead.entity';
import { ParentMessage, ParentMessageType } from '../communications/entities/parent-message.entity';
import { Student } from '../students/entities/student.entity';
import { StudentProgress } from '../students/entities/student-progress.entity';
import { StudentAttendance } from '../students/entities/student-attendance.entity';
import { DailyReport } from '../teachers/entities/daily-report.entity';
import { LeadActivity } from '../leads/entities/lead-activity.entity';
import { Media } from '../media/entities/media.entity';
import { CheckInOutRecord } from '../checkinout/entities/check-in-out-record.entity';
import { ProfileEntity } from '../users/entities/profile.entity';

@Injectable()
export class ParentDashboardService {
  private readonly logger = new Logger(ParentDashboardService.name);

  constructor(
    private readonly leadsService: LeadsService,
    @InjectRepository(Waitlist)
    private readonly waitlistRepository: Repository<Waitlist>,
    @InjectRepository(LeadInvoice)
    private readonly leadInvoiceRepository: Repository<LeadInvoice>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(ParentMessage)
    private readonly parentMessageRepository: Repository<ParentMessage>,
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(StudentProgress)
    private readonly studentProgressRepository: Repository<StudentProgress>,
    @InjectRepository(StudentAttendance)
    private readonly studentAttendanceRepository: Repository<StudentAttendance>,
    @InjectRepository(Media)
    private readonly mediaRepository: Repository<Media>,
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(LeadActivity)
    private readonly leadActivityRepository: Repository<LeadActivity>,
    @InjectRepository(DailyReport)
    private readonly dailyReportRepository: Repository<DailyReport>,
    @InjectRepository(CheckInOutRecord)
    private readonly checkInOutRepository: Repository<CheckInOutRecord>,
    @InjectRepository(ProfileEntity)
    private readonly profileRepository: Repository<ProfileEntity>,
    private readonly dataSource: DataSource,
  ) { }

  async getSummary(user: AuthUser): Promise<ParentDashboardSummaryDto> {
    if (!user.email) {
      throw new BadRequestException('Parent email is required');
    }

    const leads = await this.leadsService.findByParentEmail(user.email);
    const leadIdList = leads.map((lead) => lead.id);
    const leadNameMap = new Map(leads.map((lead) => [lead.id, lead]));

    const enrolledLeadIds = this.getEnrolledLeadIds(leads);

    const [waitlistEntries, leadInvoices, userInvoices, messages] = await Promise.all([
      this.getWaitlistEntries(leadIdList, enrolledLeadIds),
      this.getLeadInvoices(user.email),
      this.getUserInvoices(user.id, leadIdList),
      this.getMessages(user.id),
    ]);

    const payments = this.buildPayments(leadInvoices, userInvoices, leadNameMap);
    const paymentRestricted = payments.some(
      (payment) =>
        payment.status === PaymentStatus.PENDING &&
        payment.dueDate &&
        new Date(payment.dueDate) < new Date(),
    );

    return {
      waitlist: waitlistEntries,
      payments,
      messages,
      paymentRestricted,
    };
  }

  async getChildren(user: AuthUser, status?: LeadStatus): Promise<ParentChildDto[]> {
    if (!user.email) {
      throw new BadRequestException('Parent email is required');
    }

    const query = this.leadRepository
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.school', 'school')
      .where('LOWER(lead.parentEmail) = LOWER(:email)', { email: user.email });

    if (status) {
      query.andWhere('lead.leadStatus = :status', { status });
    }

    const leads = await query.orderBy('lead.createdAt', 'DESC').getMany();

    const children: ParentChildDto[] = [];

    for (const lead of leads) {
      const [enrollment, waitlist, student, activities] = await Promise.all([
        this.fetchEnrollmentForLead(lead.id),
        this.waitlistRepository.findOne({
          where: { leadId: lead.id },
          order: { createdAt: 'DESC' },
        }),
        this.findStudentForLead(lead, user.email),
        this.fetchRecentActivities(lead.id),
      ]);

      const progress = student ? await this.fetchStudentProgress(student.id) : [];

      children.push({
        id: lead.id,
        childName: lead.childName ?? 'Student',
        childBirthdate: lead.childBirthdate
          ? new Date(lead.childBirthdate as unknown as string).toISOString()
          : null,
        program: lead.program ?? null,
        leadStatus: (lead.leadStatus as string) ?? LeadStatus.NEW,
        schoolId: lead.schoolId,
        schoolName: lead.school?.name ?? null,
        createdAt: this.toIsoString(lead.createdAt),
        updatedAt: this.toIsoString(lead.updatedAt),
        teacherId: lead.assignedTo,
        // teacherName: lead.assignedTo ? await this.getProfileName(lead.assignedTo) : 'Unassigned',
        teacherName: null,
        enrollment,
        waitlist: waitlist
          ? {
            id: waitlist.id,
            status: waitlist.status,
            position: waitlist.waitlistPosition,
            program: waitlist.program,
            createdAt: waitlist.createdAt?.toISOString() ?? null,
          }
          : null,
        progress,
        studentId: student?.id ?? null,
        isCheckedIn: student ? await this.isStudentCheckedIn(student.id) : false,
        recentActivities: activities,
      });
    }

    return children;
  }

  async sendMessage(user: AuthUser, leadId: string, dto: SendParentMessageDto): Promise<void> {
    if (!user?.id) {
      throw new BadRequestException('Parent identity is required');
    }
    if (!dto.subject?.trim() || !dto.message?.trim()) {
      throw new BadRequestException('Subject and message are required');
    }

    const lead = await this.ensureLeadBelongsToParent(leadId, user);

    const enrollment = await this.fetchEnrollmentRow(lead.id, true);
    if (!enrollment) {
      throw new BadRequestException('No active enrollment found for this child');
    }

    if (!enrollment.class_id) {
      throw new BadRequestException('No class assigned to this enrollment yet');
    }

    const teacherRow = await this.dataSource.query(
      `SELECT teacher_id FROM classes WHERE id = $1 LIMIT 1`,
      [enrollment.class_id],
    );
    const teacherId = teacherRow?.[0]?.teacher_id;

    if (!teacherId) {
      throw new BadRequestException('No teacher assigned to this class yet');
    }

    const message = this.parentMessageRepository.create({
      parentId: user.id,
      teacherId,
      studentId: lead.id,
      subject: dto.subject,
      message: dto.message,
      sentByTeacher: false,
      isRead: false,
      messageType: dto.messageType ?? ParentMessageType.GENERAL,
    });

    await this.parentMessageRepository.save(message);
  }

  async getChildReports(user: AuthUser, leadId: string): Promise<ParentDailyReportDto[]> {
    const lead = await this.ensureLeadBelongsToParent(leadId, user);

    const query = this.dailyReportRepository
      .createQueryBuilder('report')
      .where('report.studentId = :leadId', { leadId })
      .orderBy('report.reportDate', 'DESC')
      .take(10);

    if (lead.childName) {
      query.orWhere(
        `EXISTS (
          SELECT 1 FROM unnest(report.student_names) AS name
          WHERE LOWER(name) = LOWER(:childName)
        )`,
        { childName: lead.childName },
      );
    }

    const reports = await query.getMany();

    return reports.map((report) => ({
      id: report.id,
      reportDate: report.reportDate?.toISOString() ?? '',
      activities: report.activities,
      meals: report.meals,
      napTime: report.napTime,
      moodBehavior: report.moodBehavior,
      notes: report.notes,
    }));
  }

  async getAllChildrenReports(user: AuthUser, query: ParentReportsQueryDto = {}): Promise<ParentReportsResponseDto> {
    if (!user.email) {
      throw new BadRequestException('Parent email is required');
    }

    const { page = 1, limit = 10, search, childId, sortBy = 'reportDate', sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    // Find all leads (children) for this parent
    const leads = await this.leadRepository.find({
      where: { parentEmail: user.email },
    });

    if (leads.length === 0) {
      return {
        data: [],
        pagination: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      };
    }

    // Filter by childId if provided
    const filteredLeads = childId ? leads.filter(lead => lead.id === childId) : leads;

    if (filteredLeads.length === 0) {
      return {
        data: [],
        pagination: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      };
    }

    const leadIds = filteredLeads.map((lead) => lead.id);
    const leadNameMap = new Map(filteredLeads.map((lead) => [lead.id, lead.childName ?? '']));

    // Build query to fetch reports for all children
    // Match by studentId OR by student_names array containing child names
    const childNames = filteredLeads.map((lead) => lead.childName).filter(Boolean);

    // Use raw SQL for better performance with array matching
    const lowerChildNames = childNames.map(name => name.toLowerCase());

    // Build WHERE conditions
    const whereConditions: string[] = [
      `(
        (student_id = ANY($1::uuid[]) AND student_id IS NOT NULL)
        OR (
          student_names IS NOT NULL 
          AND EXISTS (
            SELECT 1 FROM unnest(student_names) AS name
            WHERE LOWER(name) = ANY($2::text[])
          )
        )
      )`,
      `status = 'sent'`,
    ];

    const queryParams: any[] = [leadIds, lowerChildNames];
    let paramIndex = 3;

    // Add search filter if provided
    if (search && search.trim()) {
      whereConditions.push(
        `(
          LOWER(activities) LIKE $${paramIndex} OR
          LOWER(meals) LIKE $${paramIndex} OR
          LOWER(mood_behavior) LIKE $${paramIndex} OR
          LOWER(notes) LIKE $${paramIndex} OR
          EXISTS (
            SELECT 1 FROM unnest(student_names) AS name
            WHERE LOWER(name) LIKE $${paramIndex}
          )
        )`
      );
      queryParams.push(`%${search.toLowerCase()}%`);
      paramIndex++;
    }

    // Build ORDER BY clause
    const orderByField = sortBy === 'createdAt' ? 'created_at' : 'report_date';
    const orderByDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Build count query for total
    const countQuery = `
      SELECT COUNT(*) as total
      FROM daily_reports
      WHERE ${whereConditions.join(' AND ')}
    `;

    // Build data query with pagination
    const dataQuery = `
      SELECT *
      FROM daily_reports
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY ${orderByField} ${orderByDirection}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, skip);

    // Execute queries
    const [countResult, reports] = await Promise.all([
      this.dataSource.query(countQuery, queryParams.slice(0, -2)), // Exclude limit and offset for count
      this.dataSource.query(dataQuery, queryParams),
    ]);

    const total = parseInt(countResult[0]?.total || '0', 10);

    // Map reports and include leadId and childName
    const mappedReports = reports.map((report: any) => {
      // Find which lead this report belongs to
      let leadId = report.student_id || '';
      let childName = leadNameMap.get(leadId) || '';

      // If not found by studentId, try to match by student_names
      if (!leadNameMap.has(leadId) && report.student_names && Array.isArray(report.student_names)) {
        for (const name of report.student_names) {
          for (const [id, childNameValue] of leadNameMap.entries()) {
            if (childNameValue && name.toLowerCase().includes(childNameValue.toLowerCase())) {
              leadId = id;
              childName = childNameValue;
              break;
            }
          }
          if (leadId && leadNameMap.has(leadId)) break;
        }
      }

      return {
        id: report.id,
        reportDate: report.report_date ? new Date(report.report_date).toISOString() : '',
        activities: report.activities,
        meals: report.meals,
        napTime: report.nap_time,
        moodBehavior: report.mood_behavior,
        notes: report.notes,
        leadId,
        childName,
      };
    });

    return {
      data: mappedReports,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async getWaitlistEntries(
    leadIds: string[],
    enrolledLeadIds: Set<string>,
  ): Promise<ParentWaitlistItemDto[]> {
    if (!leadIds.length) {
      return [];
    }

    const entries = await this.waitlistRepository.find({
      where: { leadId: In(leadIds) },
      relations: ['lead', 'school'],
      order: { waitlistPosition: 'ASC' },
    });

    return entries
      .filter((entry) => !enrolledLeadIds.has(entry.leadId))
      .map((entry) => ({
        id: entry.id,
        leadId: entry.leadId,
        childName: entry.lead?.childName ?? 'Student',
        schoolName: entry.school?.name ?? 'School',
        program: entry.program,
        position: entry.waitlistPosition,
        status: entry.status,
        priorityScore: entry.priorityScore,
        updatedAt: entry.updatedAt?.toISOString() ?? entry.createdAt?.toISOString() ?? null,
      }));
  }

  private async getLeadInvoices(parentEmail: string): Promise<LeadInvoice[]> {
    return this.leadInvoiceRepository.find({
      where: { parentEmail },
      relations: ['school'],
      order: { createdAt: 'DESC' },
      take: 5,
    });
  }

  private async getUserInvoices(
    parentId: string | null | undefined,
    leadIds: string[],
  ): Promise<Invoice[]> {
    const query = this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.school', 'school')
      .orderBy('invoice.createdAt', 'DESC')
      .take(5);

    if (parentId && leadIds.length) {
      query.where('invoice.parentId = :parentId', { parentId }).orWhere(
        'invoice.leadId IN (:...leadIds)',
        { leadIds },
      );
    } else if (parentId) {
      query.where('invoice.parentId = :parentId', { parentId });
    } else if (leadIds.length) {
      query.where('invoice.leadId IN (:...leadIds)', { leadIds });
    } else {
      query.where('1 = 0');
    }

    return query.getMany();
  }

  private async getMessages(parentId: string | null | undefined): Promise<ParentMessageDto[]> {
    if (!parentId) {
      return [];
    }

    const messages = await this.messageRepository.find({
      where: { recipientId: parentId },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    return messages.map((message) => ({
      id: message.id,
      subject: message.subject,
      content: message.content,
      isRead: message.isRead,
      createdAt: message.createdAt?.toISOString() ?? '',
      studentId: message.studentId,
    }));
  }

  private getEnrolledLeadIds(leads: LeadEntity[]): Set<string> {
    const enrolledStatuses = new Set<string>([
      LeadStatus.CONVERTED,
      LeadStatus.QUALIFIED,
      'enrolled',
      'approved_for_registration',
      'confirmed',
      'active',
    ]);

    return new Set(
      leads
        .map((lead) => ({
          id: lead.id,
          status: (lead.leadStatus as string | undefined)?.toLowerCase?.() ?? '',
        }))
        .filter((lead) => enrolledStatuses.has(lead.status))
        .map((lead) => lead.id),
    );
  }

  private buildPayments(
    leadInvoices: LeadInvoice[],
    invoices: Invoice[],
    leadNameMap: Map<string, any>,
  ): ParentPaymentDto[] {
    const leadInvoiceDtos: ParentPaymentDto[] = leadInvoices.map((invoice) => ({
      id: invoice.id,
      source: 'lead_invoice',
      amount: Math.round(Number(invoice.amount || 0) * 100),
      currency: invoice.currency ?? 'usd',
      status: invoice.status,
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString() : null,
      createdAt: invoice.createdAt ? new Date(invoice.createdAt).toISOString() : '',
      childName: leadNameMap.get(invoice.leadId)?.childName ?? undefined,
      schoolName: invoice.school?.name,
    }));

    const invoiceDtos: ParentPaymentDto[] = invoices.map((invoice) => ({
      id: invoice.id,
      source: 'invoice',
      amount: invoice.amount ?? 0,
      currency: invoice.currency ?? 'usd',
      status: invoice.status,
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString() : null,
      createdAt: invoice.createdAt ? new Date(invoice.createdAt).toISOString() : '',
      childName: invoice.leadId ? leadNameMap.get(invoice.leadId)?.childName : undefined,
      schoolName: invoice.school?.name,
    }));

    return [...leadInvoiceDtos, ...invoiceDtos]
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 5);
  }

  private async fetchEnrollmentForLead(leadId: string): Promise<ParentChildEnrollmentDto | null> {
    const row = await this.fetchEnrollmentRow(leadId, false);
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      status: row.status ?? 'pending',
      startDate: row.start_date ? new Date(row.start_date).toISOString() : null,
      endDate: row.end_date ? new Date(row.end_date).toISOString() : null,
      tuitionAmount: row.tuition_amount !== null ? Number(row.tuition_amount) : null,
      classId: row.class_id || null,
    };
  }

  private async fetchEnrollmentRow(leadId: string, activeOnly: boolean): Promise<any | null> {
    try {
      const params: any[] = [leadId];
      let query = `
        SELECT id, lead_id, status, start_date, end_date, tuition_amount, class_id
        FROM enrollment
        WHERE lead_id = $1
      `;

      if (activeOnly) {
        query += ` AND status = 'active'`;
      }

      query += ` ORDER BY created_at DESC LIMIT 1`;

      const result = await this.dataSource.query(query, params);
      if (result?.length) {
        return result[0];
      }
    } catch (error: any) {
      this.logger.warn(`Failed to fetch enrollment for lead ${leadId}: ${error.message}`);
    }

    return null;
  }

  private async findStudentForLead(
    lead: LeadEntity,
    parentEmail: string | null | undefined,
  ): Promise<Student | null> {
    if (!parentEmail || !lead.childName) {
      return null;
    }

    const [firstName] = lead.childName.trim().split(/\s+/);
    if (!firstName) {
      return null;
    }

    return this.studentRepository
      .createQueryBuilder('student')
      .where('LOWER(student.parentEmail) = LOWER(:email)', { email: parentEmail })
      .andWhere('LOWER(student.firstName) = LOWER(:firstName)', { firstName })
      .orderBy('student.createdAt', 'DESC')
      .getOne();
  }

  private async fetchStudentProgress(studentId: string): Promise<ParentChildProgressDto[]> {
    const progress = await this.studentProgressRepository.find({
      where: { studentId },
      order: { assessmentDate: 'DESC' },
      take: 5,
    });

    return progress.map((item) => ({
      id: item.id,
      subject: item.subject,
      progressPercentage: Number(item.progressPercentage) ?? 0,
      teacherComments: item.teacherComments,
      assessmentDate: item.assessmentDate?.toISOString() ?? null,
    }));
  }

  private async fetchRecentActivities(leadId: string): Promise<ParentChildActivityDto[]> {
    const activities = await this.leadActivityRepository.find({
      where: { leadId },
      order: { createdAt: 'DESC' },
      take: 3,
    });

    return activities.map((activity) => ({
      activityType: activity.activityType,
      notes: activity.notes,
      createdAt: activity.createdAt?.toISOString() ?? '',
    }));
  }

  private async isStudentCheckedIn(studentId: string): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkIn = await this.checkInOutRepository.findOne({
      where: {
        studentId,
        checkInTime: MoreThanOrEqual(today),
        checkOutTime: IsNull(),
      },
      select: ['id'],
    });

    return !!checkIn;
  }

  private async ensureLeadBelongsToParent(leadId: string, user: AuthUser): Promise<LeadEntity> {
    const lead = await this.leadRepository.findOne({ where: { id: leadId } });
    if (!lead) {
      throw new BadRequestException('Child not found');
    }

    if (!user.email || lead.parentEmail?.toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('You do not have access to this child');
    }

    return lead;
  }

  async getAttendance(user: AuthUser): Promise<ParentAttendanceDto[]> {
    if (!user.email) {
      throw new BadRequestException('Parent email is required');
    }

    // Find all students for this parent
    const students = await this.studentRepository.find({
      where: { parentEmail: user.email },
    });

    if (students.length === 0) {
      return [];
    }

    const studentIds = students.map((s) => s.id);
    const studentMap = new Map(students.map((s) => [s.id, s]));

    // Fetch all leads for this parent to build a mapping
    const leads = await this.leadRepository.find({
      where: { parentEmail: user.email },
    });

    // Build a map from student name to leadId
    const studentNameToLeadIdMap = new Map<string, string>();
    for (const lead of leads) {
      if (lead.childName) {
        const [firstName] = lead.childName.trim().split(/\s+/);
        for (const student of students) {
          if (student.firstName.toLowerCase() === firstName.toLowerCase()) {
            studentNameToLeadIdMap.set(student.id, lead.id);
            break;
          }
        }
      }
    }

    // Fetch attendance records
    const attendanceRecords = await this.studentAttendanceRepository.find({
      where: { studentId: In(studentIds) },
      order: { date: 'DESC' },
      take: 50,
    });

    // Map attendance to DTOs, including leadId by matching student to lead
    const attendanceDtos: ParentAttendanceDto[] = attendanceRecords.map((record) => {
      const leadId = studentNameToLeadIdMap.get(record.studentId) ?? null;
      return {
        id: record.id,
        date: record.date?.toISOString() ?? '',
        status: record.status,
        notes: record.notes,
        studentId: record.studentId,
        leadId,
        teacherId: record.teacherId,
        createdAt: record.createdAt?.toISOString() ?? '',
      };
    });

    return attendanceDtos;
  }

  async getProgress(user: AuthUser): Promise<ParentProgressDto[]> {
    if (!user.email) {
      throw new BadRequestException('Parent email is required');
    }

    // Find all students for this parent
    const students = await this.studentRepository.find({
      where: { parentEmail: user.email },
    });

    if (students.length === 0) {
      return [];
    }

    const studentIds = students.map((s) => s.id);

    // Fetch all leads for this parent to build a mapping
    const leads = await this.leadRepository.find({
      where: { parentEmail: user.email },
    });

    // Build a map from student name to leadId
    const studentNameToLeadIdMap = new Map<string, string>();
    for (const lead of leads) {
      if (lead.childName) {
        const [firstName] = lead.childName.trim().split(/\s+/);
        for (const student of students) {
          if (student.firstName.toLowerCase() === firstName.toLowerCase()) {
            studentNameToLeadIdMap.set(student.id, lead.id);
            break;
          }
        }
      }
    }

    // Fetch progress records
    const progressRecords = await this.studentProgressRepository.find({
      where: { studentId: In(studentIds) },
      order: { assessmentDate: 'DESC' },
    });

    // Map progress to DTOs, including leadId by matching student to lead
    const progressDtos: ParentProgressDto[] = progressRecords.map((record) => {
      const leadId = studentNameToLeadIdMap.get(record.studentId) ?? null;
      return {
        id: record.id,
        subject: record.subject,
        progressPercentage: Number(record.progressPercentage) ?? 0,
        grade: record.grade,
        teacherComments: record.teacherComments,
        assessmentDate: record.assessmentDate?.toISOString() ?? null,
        studentId: record.studentId,
        leadId,
        createdAt: record.createdAt?.toISOString() ?? '',
      };
    });

    return progressDtos;
  }

  async getInvoices(user: AuthUser, schoolId?: string, limit: number = 50): Promise<ParentInvoiceDto[]> {
    if (!user.email) {
      throw new BadRequestException('Parent email is required');
    }

    const leads = await this.leadsService.findByParentEmail(user.email);
    const leadIdList = leads.map((lead) => lead.id);

    // Fetch both invoice types
    const [leadInvoices, userInvoices] = await Promise.all([
      this.getLeadInvoicesForParent(user.email, schoolId, limit),
      this.getUserInvoicesForParent(user.id, leadIdList, schoolId, limit),
    ]);

    // Combine and normalize both invoice types
    const allInvoices: ParentInvoiceDto[] = [
      ...userInvoices.map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoiceNumber,
        amount: inv.amount ?? 0,
        currency: inv.currency ?? 'usd',
        due_date: inv.dueDate ? new Date(inv.dueDate).toISOString() : '',
        status: inv.status,
        created_at: inv.createdAt ? new Date(inv.createdAt).toISOString() : '',
        payment_date: inv.paymentDate ? new Date(inv.paymentDate).toISOString() : null,
        notes: inv.notes ?? null,
        source: 'invoice' as const,
        lead_id: inv.leadId ?? null,
        school_id: inv.schoolId,
        school_name: inv.school?.name || 'Preschool',
        transaction_id: inv.transactionId ?? inv.stripePaymentIntentId ?? null,
      })),
      ...leadInvoices.map((inv) => ({
        id: inv.id,
        invoice_number: inv.invoiceNumber,
        amount: Number(inv.amount || 0),
        currency: inv.currency ?? 'usd',
        due_date: inv.dueDate ? new Date(inv.dueDate).toISOString() : '',
        status: inv.status,
        created_at: inv.createdAt ? new Date(inv.createdAt).toISOString() : '',
        payment_date: inv.paidAt ? new Date(inv.paidAt).toISOString() : null,
        notes: inv.notes ?? null,
        source: 'lead_invoice' as const,
        lead_id: inv.leadId ?? null,
        school_id: inv.schoolId,
        school_name: inv.school?.name || 'Preschool',
        transaction_id: inv.stripePaymentIntentId ?? null,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return allInvoices.slice(0, limit);
  }

  private async getLeadInvoicesForParent(
    parentEmail: string,
    schoolId?: string,
    limit: number = 50,
  ): Promise<LeadInvoice[]> {
    const query = this.leadInvoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.school', 'school')
      .where('LOWER(invoice.parentEmail) = LOWER(:email)', { email: parentEmail })
      .orderBy('invoice.createdAt', 'DESC')
      .take(limit);

    if (schoolId) {
      query.andWhere('invoice.schoolId = :schoolId', { schoolId });
    }

    return query.getMany();
  }

  private async getUserInvoicesForParent(
    parentId: string | null | undefined,
    leadIds: string[],
    schoolId?: string,
    limit: number = 50,
  ): Promise<Invoice[]> {
    const query = this.invoiceRepository
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.school', 'school')
      .orderBy('invoice.createdAt', 'DESC')
      .take(limit);

    if (parentId && leadIds.length) {
      query.where('invoice.parentId = :parentId', { parentId }).orWhere('invoice.leadId IN (:...leadIds)', {
        leadIds,
      });
    } else if (parentId) {
      query.where('invoice.parentId = :parentId', { parentId });
    } else if (leadIds.length) {
      query.where('invoice.leadId IN (:...leadIds)', { leadIds });
    } else {
      query.where('1 = 0');
    }

    if (schoolId) {
      query.andWhere('invoice.schoolId = :schoolId', { schoolId });
    }

    return query.getMany();
  }

  async getMedia(user: AuthUser): Promise<ParentMediaDto[]> {
    if (!user.email) {
      throw new BadRequestException('Parent email is required');
    }

    // Find all leads (children) for this parent
    const leads = await this.leadRepository.find({
      where: { parentEmail: user.email },
    });

    if (leads.length === 0) {
      return [];
    }

    const childIds = leads.map((lead) => lead.id);

    // Fetch media for all children
    const mediaRecords = await this.mediaRepository.find({
      where: { childId: In(childIds) },
      order: { createdAt: 'DESC' },
    });

    return mediaRecords.map((media) => ({
      id: media.id,
      childId: media.childId,
      fileUrl: media.fileUrl,
      fileName: media.fileName,
      fileType: media.fileType,
      description: media.description,
      createdAt: media.createdAt?.toISOString() ?? '',
    }));
  }

  private toIsoString(value: Date | string | null | undefined): string {
    if (!value) {
      return '';
    }
    const dateValue = value instanceof Date ? value : new Date(value);
    return Number.isNaN(dateValue.getTime()) ? '' : dateValue.toISOString();
  }
}


