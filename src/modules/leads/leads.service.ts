import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { LeadEntity, LeadSource, LeadStatus } from './entities/lead.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadActivity } from './entities/lead-activity.entity';
import { LeadReminder } from './entities/lead-reminder.entity';
import { LeadInvoice } from './entities/lead-invoice.entity';
import { SchoolEntity } from '../schools/entities/school.entity';
import { CreateParentLeadDto } from './dto/create-parent-lead.dto';
import { Waitlist } from '../enrollment/entities/waitlist.entity';
import { EnrollmentEntity } from '../enrollment/entities/enrollment.entity';
import { ClassEntity } from '../classes/entities/class.entity';
import { RealtimeGateway, LeadRealtimeAction } from '../realtime/realtime.gateway';

import { LeadStatusType } from '../../common/enums/lead-status-type.enum';
import { AnalyzeWaitlistLeadDto, LeadAnalysisResponseDto } from './dto/analyze-waitlist-lead.dto';
import { LeadInteraction } from './entities/lead-interaction.entity';
import { StudentDocument } from '../students/entities/student-document.entity';
import { ProfileEntity } from '../users/entities/profile.entity';
import { UserRoleEntity } from '../users/entities/user-role.entity';
import { CreateLeadInteractionDto } from './dto/create-lead-interaction.dto';
import { UpdateLeadDetailsDto } from './dto/update-lead-details.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { DataSource } from 'typeorm';
import { Student } from '../students/entities/student.entity';
import { AppRole } from '../../common/enums/app-role.enum';

interface LeadCreationContext {
  createdBy?: string | null;
  entryPoint: 'internal' | 'public_form' | 'parent_portal';
  // metadataOverrides removed - metadata column doesn't exist in database schema
  statusOverride?: LeadStatus;
  sourceFallback?: LeadSource | null;
}

interface LeadActivityLogPayload {
  leadId: string;
  activityType: string;
  userId?: string | null;
  oldValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  notes?: string | null;
  metadata?: Record<string, any>;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(LeadActivity)
    private readonly leadActivityRepository: Repository<LeadActivity>,
    @InjectRepository(LeadReminder)
    private readonly leadReminderRepository: Repository<LeadReminder>,
    @InjectRepository(LeadInvoice)
    private readonly leadInvoiceRepository: Repository<LeadInvoice>,
    @InjectRepository(SchoolEntity)
    private readonly schoolRepository: Repository<SchoolEntity>,
    @InjectRepository(Waitlist)
    private readonly waitlistRepository: Repository<Waitlist>,
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentRepository: Repository<EnrollmentEntity>,
    @InjectRepository(ClassEntity)
    private readonly classRepository: Repository<ClassEntity>,
    @InjectRepository(LeadInteraction)
    private readonly leadInteractionRepository: Repository<LeadInteraction>,
    @InjectRepository(StudentDocument)
    private readonly studentDocumentRepository: Repository<StudentDocument>,
    @InjectRepository(ProfileEntity)
    private readonly profileRepository: Repository<ProfileEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepository: Repository<UserRoleEntity>,
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly dataSource: DataSource,
  ) { }

  /**
   * Create a lead internally (staff, admins, owners)
   */
  async create(createLeadDto: CreateLeadDto, createdBy?: string): Promise<LeadEntity> {
    const lead = await this.persistLead(createLeadDto, {
      createdBy: createdBy ?? null,
      entryPoint: 'internal',
      sourceFallback: createLeadDto.source ?? LeadSource.OTHER,
    });
    return lead;
  }

  /**
   * Public-facing lead creation endpoint used by marketing forms
   */
  async createPublicLead(createLeadDto: CreateLeadDto): Promise<LeadEntity> {
    const lead = await this.persistLead(createLeadDto, {
      createdBy: null,
      entryPoint: 'public_form',
      sourceFallback: createLeadDto.source ?? LeadSource.WEBSITE,
    });
    return lead;
  }

  /**
   * Parent registration flow (waitlist, enrollment interest)
   */
  async createParentLead(createParentLeadDto: CreateParentLeadDto): Promise<LeadEntity> {
    const {
      joinWaitlist,
      hearAboutUs,
      referralCode,
      familyNotes,
      ...leadValues
    } = createParentLeadDto as CreateParentLeadDto & Record<string, any>;

    const lead = await this.persistLead(leadValues as CreateLeadDto, {
      createdBy: null,
      entryPoint: 'parent_portal',
      sourceFallback: createParentLeadDto.source ?? LeadSource.WEBSITE,
    });

    if (createParentLeadDto.joinWaitlist) {
      await this.addLeadToWaitlist(lead, createParentLeadDto.programInterest);
    }

    return lead;
  }

  /**
   * Find all leads with optional filtering
   */
  async findAll(options?: {
    schoolId?: string;
    status?: LeadStatus;
    source?: LeadSource;
    assignedTo?: string;
    parentEmail?: string;
    createdBy?: string;
    followUpDate?: Date;
    fromDate?: string | Date;
    toDate?: string | Date;
    hasTourDate?: boolean;
    tourDate?: string | Date;
    isActive?: boolean;
    limit?: number;
    offset?: number;
    orderBy?: string;
    order?: 'ASC' | 'DESC';
  }): Promise<{ data: LeadEntity[]; total: number }> {
    const {
      schoolId,
      status,
      source,
      assignedTo,
      parentEmail,
      createdBy,
      followUpDate,
      fromDate,
      toDate,
      hasTourDate,
      tourDate,
      isActive,
      limit = 100,
      offset = 0,
      orderBy = 'created_at',
      order = 'DESC',
    } = options || {};

    const queryBuilder = this.leadRepository.createQueryBuilder('lead');

    if (schoolId) {
      queryBuilder.where('lead.school_id = :schoolId', { schoolId });
    }

    if (status) {
      queryBuilder.andWhere('lead.lead_status = :status', { status });
    }

    if (source) {
      queryBuilder.andWhere('lead.lead_source_new = :source', { source });
    }

    if (assignedTo) {
      queryBuilder.andWhere('lead.assigned_to = :assignedTo', { assignedTo });
    }

    if (parentEmail) {
      queryBuilder.andWhere('LOWER(lead.parent_email) = LOWER(:parentEmail)', { parentEmail });
    }

    // created_by column doesn't exist in database schema
    // if (createdBy) {
    //   queryBuilder.andWhere('lead.created_by = :createdBy', { createdBy });
    // }

    if (followUpDate) {
      queryBuilder.andWhere('lead.next_follow_up_at <= :followUpDate', { followUpDate });
    }

    if (fromDate) {
      const from = typeof fromDate === 'string' ? new Date(fromDate) : fromDate;
      queryBuilder.andWhere('lead.created_at >= :fromDate', { fromDate: from });
    }

    if (toDate) {
      const to = typeof toDate === 'string' ? new Date(toDate) : toDate;
      // Add one day to include the entire end date
      const toDateEnd = new Date(to);
      toDateEnd.setHours(23, 59, 59, 999);
      queryBuilder.andWhere('lead.created_at <= :toDate', { toDate: toDateEnd });
    }

    if (isActive !== undefined) {
      queryBuilder.andWhere('lead.is_active = :isActive', { isActive });
    }

    if (hasTourDate === true) {
      queryBuilder.andWhere('lead.tour_date IS NOT NULL');
    } else if (hasTourDate === false) {
      queryBuilder.andWhere('lead.tour_date IS NULL');
    }

    if (tourDate) {
      const tour = typeof tourDate === 'string' ? new Date(tourDate) : tourDate;
      const tourStart = new Date(tour);
      tourStart.setHours(0, 0, 0, 0);
      const tourEnd = new Date(tour);
      tourEnd.setHours(23, 59, 59, 999);
      queryBuilder.andWhere('lead.tour_date >= :tourDateStart', { tourDateStart: tourStart });
      queryBuilder.andWhere('lead.tour_date <= :tourDateEnd', { tourDateEnd: tourEnd });
    }

    // Validate orderBy field to prevent SQL injection
    const validOrderByFields = ['created_at', 'updated_at', 'lead_status', 'parent_email', 'child_name'];
    const safeOrderBy = validOrderByFields.includes(orderBy) ? orderBy : 'created_at';
    const safeOrder = order === 'ASC' ? 'ASC' : 'DESC';

    queryBuilder
      .orderBy(`lead.${safeOrderBy}`, safeOrder)
      .skip(offset)
      .take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return { data, total };
  }

  private async addLeadToWaitlist(lead: LeadEntity, programInterest?: string | null) {
    const program = programInterest || lead.program || 'general';

    const existing = await this.waitlistRepository.findOne({
      where: { leadId: lead.id },
    });

    if (existing) {
      return existing;
    }

    const position = await this.waitlistRepository.count({
      where: { schoolId: lead.schoolId, program },
    });

    const waitlistEntry = this.waitlistRepository.create({
      leadId: lead.id,
      schoolId: lead.schoolId,
      program,
      waitlistPosition: position + 1,
      priorityScore: 0,
      status: LeadStatusType.WAITLISTED,
    });

    return this.waitlistRepository.save(waitlistEntry);
  }

  /**
   * Find a lead by ID
   */
  async findOne(id: string): Promise<LeadEntity> {
    const lead = await this.leadRepository.findOne({
      where: { id },
      relations: ['school'],
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${id}" not found`);
    }

    return lead;
  }

  /**
   * Find leads by school ID
   */
  async findBySchool(schoolId: string, options?: {
    status?: LeadStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ data: LeadEntity[]; total: number }> {
    return this.findAll({
      schoolId,
      ...options,
    });
  }

  /**
   * Find leads assigned to a user
   */
  async findByAssignedTo(userId: string, options?: {
    status?: LeadStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ data: LeadEntity[]; total: number }> {
    return this.findAll({
      assignedTo: userId,
      ...options,
    });
  }

  /**
   * Find leads that need follow-up (follow-up date is today or in the past)
   */
  async findLeadsNeedingFollowUp(schoolId?: string): Promise<LeadEntity[]> {
    const queryBuilder = this.leadRepository.createQueryBuilder('lead');

    queryBuilder.where('lead.next_follow_up_at IS NOT NULL');
    queryBuilder.andWhere('lead.next_follow_up_at <= :today', { today: new Date() });
    queryBuilder.andWhere('lead.lead_status NOT IN (:...excludedStatuses)', {
      excludedStatuses: [LeadStatus.CONVERTED, LeadStatus.LOST],
    });

    if (schoolId) {
      queryBuilder.andWhere('lead.school_id = :schoolId', { schoolId });
    }

    queryBuilder.orderBy('lead.next_follow_up_at', 'ASC');

    return queryBuilder.getMany();
  }

  /**
   * Find leads by parent email (case-insensitive)
   */
  async findByParentEmail(email: string): Promise<LeadEntity[]> {
    if (!email) {
      return [];
    }




    const leads = await this.leadRepository
      .createQueryBuilder('lead')
      .where('LOWER(lead.parent_email) = LOWER(:email)', { email })
      .orderBy('lead.created_at', 'DESC')
      .getMany();

    return leads;
  }

  /**
   * Get lead activities for a school
   */
  async getActivitiesBySchool(
    schoolId: string,
    options?: {
      activityTypes?: string[];
      limit?: number;
    },
  ): Promise<LeadActivity[]> {
    const { activityTypes, limit = 100 } = options || {};

    const queryBuilder = this.leadActivityRepository
      .createQueryBuilder('activity')
      .innerJoinAndSelect('activity.lead', 'lead')
      .where('lead.school_id = :schoolId', { schoolId });

    if (activityTypes && activityTypes.length > 0) {
      queryBuilder.andWhere('activity.activity_type IN (:...activityTypes)', { activityTypes });
    }

    queryBuilder.orderBy('activity.createdAt', 'DESC').take(limit);

    return queryBuilder.getMany();
  }

  /**
   * Get lead activities by lead IDs
   */
  async getActivitiesByLeadIds(
    leadIds: string[],
    options?: {
      activityTypes?: string[];
    },
  ): Promise<LeadActivity[]> {
    if (!leadIds || leadIds.length === 0) {
      return [];
    }

    const { activityTypes } = options || {};

    const queryBuilder = this.leadActivityRepository
      .createQueryBuilder('activity')
      .innerJoinAndSelect('activity.lead', 'lead')
      .where('activity.lead_id IN (:...leadIds)', { leadIds });

    if (activityTypes && activityTypes.length > 0) {
      queryBuilder.andWhere('activity.activity_type IN (:...activityTypes)', { activityTypes });
    }

    queryBuilder.orderBy('activity.createdAt', 'ASC');

    return queryBuilder.getMany();
  }

  /**
   * Get reminders (tasks) assigned to a specific user
   */
  async getRemindersByAssignee(assignedTo: string): Promise<LeadReminder[]> {
    const queryBuilder = this.leadReminderRepository
      .createQueryBuilder('reminder')
      .leftJoinAndSelect('reminder.lead', 'lead')
      .where('reminder.assigned_to = :assignedTo', { assignedTo })
      .orderBy('reminder.scheduledFor', 'ASC');

    return queryBuilder.getMany();
  }

  /**
   * Update reminder status
   */
  async updateReminderStatus(id: string, status: string): Promise<LeadReminder> {
    const reminder = await this.leadReminderRepository.findOne({ where: { id } });
    if (!reminder) {
      throw new NotFoundException(`Reminder with ID "${id}" not found`);
    }
    reminder.status = status as any;
    return this.leadReminderRepository.save(reminder);
  }

  async findOneByParentEmailAndSchool(email: string, schoolId: string): Promise<LeadEntity | null> {
    if (!email || !schoolId) {
      return null;
    }

    return this.leadRepository.findOne({
      where: {
        parentEmail: email.toLowerCase(),
        schoolId,
      },
    });
  }

  /**
   * Update a lead
   */
  async update(id: string, updateLeadDto: UpdateLeadDto, updatedBy?: string): Promise<LeadEntity> {
    this.logger.log(`Updating lead: ${id}`);

    const lead = await this.findOne(id);
    const beforeSnapshot = this.snapshotLead(lead);
    const updateData = this.buildUpdatePayload(updateLeadDto);

    Object.assign(lead, updateData);
    const savedLead = await this.leadRepository.save(lead);

    await this.recordActivity({
      leadId: id,
      userId: updatedBy ?? null,
      activityType: 'lead_updated',
      oldValue: beforeSnapshot,
      newValue: this.snapshotLead(savedLead),
      metadata: { updatedFields: Object.keys(updateData) },
    });

    this.emitLeadRealtimeEvent(savedLead, 'updated', { fields: Object.keys(updateData) });
    return savedLead;
  }

  /**
   * Update lead status
   */
  async updateStatus(
    id: string,
    status: LeadStatus,
    followUpDate?: Date,
    updatedBy?: string,
  ): Promise<LeadEntity> {
    this.logger.log(`Updating lead ${id} status to ${status}`);

    const lead = await this.findOne(id);
    const beforeSnapshot = this.snapshotLead(lead);
    lead.leadStatus = status;

    if (followUpDate) {
      lead.nextFollowUpAt = followUpDate;
    }

    // convertedAt doesn't exist in database schema - use conversion_date instead
    if (status === LeadStatus.CONVERTED && !lead.conversionDate) {
      lead.conversionDate = new Date();
    }

    const savedLead = await this.leadRepository.save(lead);
    await this.recordActivity({
      leadId: id,
      userId: updatedBy ?? null,
      activityType: 'lead_status_changed',
      oldValue: beforeSnapshot,
      newValue: this.snapshotLead(savedLead),
      metadata: { status },
    });

    this.emitLeadRealtimeEvent(savedLead, 'status_changed', { status, followUpDate });
    return savedLead;
  }

  /**
   * Assign lead to a user
   */
  async assignTo(id: string, userId: string, assignedBy?: string, note?: string): Promise<LeadEntity> {
    this.logger.log(`Assigning lead ${id} to user ${userId}`);

    const lead = await this.findOne(id);
    const beforeSnapshot = this.snapshotLead(lead);
    lead.assignedTo = userId;

    const savedLead = await this.leadRepository.save(lead);
    await this.recordActivity({
      leadId: id,
      userId: assignedBy ?? null,
      activityType: 'lead_assigned',
      oldValue: beforeSnapshot,
      newValue: this.snapshotLead(savedLead),
      metadata: { assignedTo: userId },
      notes: note ?? null,
    });

    this.emitLeadRealtimeEvent(savedLead, 'assigned', { assignedTo: userId });
    return savedLead;
  }

  /**
   * Convert lead to enrollment
   */
  async convertToEnrollment(
    id: string,
    enrollmentId: string,
    convertedBy?: string,
  ): Promise<LeadEntity> {
    this.logger.log(`Converting lead ${id} to enrollment ${enrollmentId}`);

    const lead = await this.findOne(id);
    lead.leadStatus = LeadStatus.CONVERTED;
    // convertedToEnrollmentId doesn't exist in schema - can't store it
    lead.conversionDate = new Date();

    const savedLead = await this.leadRepository.save(lead);
    await this.recordActivity({
      leadId: id,
      userId: convertedBy ?? null,
      activityType: 'lead_converted',
      metadata: { enrollmentId },
      oldValue: this.snapshotLead(lead),
      newValue: this.snapshotLead(savedLead),
    });

    this.emitLeadRealtimeEvent(savedLead, 'status_changed', { status: LeadStatus.CONVERTED, enrollmentId });
    return savedLead;
  }

  /**
   * Delete a lead (hard delete for now, but recorded in activity log)
   */
  async remove(id: string, deletedBy?: string): Promise<void> {
    this.logger.log(`Deleting lead: ${id}`);

    const lead = await this.findOne(id);
    await this.leadRepository.remove(lead);

    await this.recordActivity({
      leadId: id,
      userId: deletedBy ?? null,
      activityType: 'lead_deleted',
      metadata: { reason: 'manual_delete' },
    });
    this.emitLeadRealtimeEvent(lead, 'deleted');
  }

  /**
   * Generate analysis summary for a waitlist lead
   */
  async analyzeWaitlistLead(
    dto: AnalyzeWaitlistLeadDto,
    requestedBy?: string,
  ): Promise<LeadAnalysisResponseDto> {
    this.logger.log(`Analyzing waitlist lead ${dto.leadId} for user ${requestedBy}`);

    const recommendations: string[] = [];
    let priorityScore = dto.leadScore ?? 50;

    const normalizedStatus = (dto.status || '').toLowerCase();

    if (dto.priority?.toLowerCase() === 'high') {
      priorityScore += 20;
      recommendations.push('Prioritize outreach due to high lead priority.');
    } else if (dto.priority?.toLowerCase() === 'sibling') {
      priorityScore += 10;
      recommendations.push('Sibling lead detected. Highlight family benefits.');
    }

    if ((dto.availableSpots ?? 0) > 0 && normalizedStatus === 'waitlisted') {
      priorityScore += 10;
      recommendations.push('Program has openings. Consider sending an offer.');
    }

    if (dto.nextFollowUp) {
      const followUpDate = new Date(dto.nextFollowUp);
      const now = new Date();
      if (!isNaN(followUpDate.getTime()) && followUpDate <= now) {
        priorityScore += 5;
        recommendations.push('Follow-up date has passed. Contact the family as soon as possible.');
      }
    }

    if (!normalizedStatus || normalizedStatus === 'new') {
      recommendations.push('No recent engagement recorded. Introduce the program and schedule a call.');
    } else if (normalizedStatus === 'toured') {
      recommendations.push('Lead already toured. Share enrollment paperwork and next steps.');
    }

    priorityScore = Math.max(0, Math.min(100, Math.round(priorityScore)));

    const summaryParts: string[] = [];
    summaryParts.push(
      `${dto.childName || 'This lead'} is currently ${normalizedStatus || 'waiting'}.`,
    );

    if ((dto.availableSpots ?? 0) > 0) {
      summaryParts.push(`${dto.availableSpots} spot(s) are available in the requested program.`);
    }

    if (dto.priority) {
      summaryParts.push(`Priority level: ${dto.priority}.`);
    }

    if (dto.nextFollowUp) {
      summaryParts.push(`Next follow-up scheduled for ${dto.nextFollowUp}.`);
    }

    if (!summaryParts.length) {
      summaryParts.push('No additional data provided for this lead.');
    }

    if (!recommendations.length) {
      recommendations.push('Maintain regular communication cadence.');
    }

    return {
      summary: summaryParts.join(' '),
      recommendations,
      priorityScore,
    };
  }

  /**
   * Check if a lead exists
   */
  async exists(id: string): Promise<boolean> {
    const count = await this.leadRepository.count({ where: { id } });
    return count > 0;
  }

  /**
   * Get leads statistics for a school
   */
  async getStatistics(schoolId: string): Promise<{
    total: number;
    byStatus: Record<LeadStatus, number>;
    bySource: Record<string, number>;
    converted: number;
    conversionRate: number;
  }> {
    const leads = await this.leadRepository.find({
      where: { schoolId },
    });

    const byStatus: Record<LeadStatus, number> = {
      [LeadStatus.NEW]: 0,
      [LeadStatus.CONTACTED]: 0,
      [LeadStatus.QUALIFIED]: 0,
      [LeadStatus.CONVERTED]: 0,
      [LeadStatus.LOST]: 0,
      [LeadStatus.NURTURING]: 0,
      [LeadStatus.REGISTERED]: 0,
      [LeadStatus.INVOICE_SENT]: 0,
      [LeadStatus.APPROVED_FOR_REGISTRATION]: 0,
      [LeadStatus.ENROLLED]: 0,
      [LeadStatus.TOURED]: 0,
      [LeadStatus.INTERESTED]: 0,
      [LeadStatus.NOT_INTERESTED]: 0,
      [LeadStatus.DECLINED]: 0,
      [LeadStatus.DROPPED]: 0,
      [LeadStatus.WAITLISTED]: 0,
      [LeadStatus.OFFER_SENT]: 0,
      [LeadStatus.CONFIRMED]: 0,
    };

    const bySource: Record<string, number> = {};
    let converted = 0;

    leads.forEach((lead) => {
      byStatus[lead.leadStatus]++;
      if (lead.leadSource) {
        bySource[lead.leadSource] = (bySource[lead.leadSource] || 0) + 1;
      }
      if (lead.leadStatus === LeadStatus.CONVERTED) {
        converted++;
      }
    });

    const conversionRate = leads.length > 0 ? (converted / leads.length) * 100 : 0;

    return {
      total: leads.length,
      byStatus,
      bySource,
      converted,
      conversionRate: Math.round(conversionRate * 100) / 100,
    };
  }

  private async persistLead(dto: CreateLeadDto, context: LeadCreationContext): Promise<LeadEntity> {
    await this.ensureSchoolExists(dto.schoolId);
    const payload = this.buildLeadEntityPayload(dto, context);
    const lead = this.leadRepository.create(payload);
    const savedLead = await this.leadRepository.save(lead);

    await this.recordActivity({
      leadId: savedLead.id,
      userId: context.createdBy ?? null,
      activityType: 'lead_created',
      metadata: {
        entryPoint: context.entryPoint,
        schoolId: savedLead.schoolId,
        source: savedLead.leadSource,
      },
    });

    this.emitLeadRealtimeEvent(savedLead, 'created');
    return savedLead;
  }

  private buildLeadEntityPayload(dto: CreateLeadDto, context: LeadCreationContext): Partial<LeadEntity> {
    // Combine first and last names
    const parentName = dto.parentFirstName || dto.parentLastName
      ? `${dto.parentFirstName || ''} ${dto.parentLastName || ''}`.trim()
      : null;
    const childName = dto.childFirstName || dto.childLastName
      ? `${dto.childFirstName || ''} ${dto.childLastName || ''}`.trim()
      : null;

    const metadata = dto.metadata ?? {};

    const payload: Partial<LeadEntity> = {
      parentName: parentName || '',
      parentEmail: dto.email?.toLowerCase() ?? '',
      parentPhone: dto.phone ?? null,
      secondaryContactPhone: dto.alternatePhone ?? null,
      childName: childName || '',
      schoolId: dto.schoolId,
      program: dto.programInterest ?? null,
      notes: dto.notes ?? null,
      // internalNotes doesn't exist in database schema
      assignedTo: dto.assignedTo ?? null,
      // metadata column doesn't exist in database schema
    };

    payload.childBirthdate = dto.childDateOfBirth ? new Date(dto.childDateOfBirth) : null;
    // preferredStartDate doesn't exist in database schema
    payload.nextFollowUpAt = dto.followUpDate ? new Date(dto.followUpDate) : null;
    payload.leadStatus = context.statusOverride ?? dto.status ?? LeadStatus.NEW;

    const metadataLeadSource = typeof metadata.leadSource === 'string' ? metadata.leadSource.toLowerCase() : null;
    const resolvedLeadSource = metadataLeadSource && Object.values(LeadSource).includes(metadataLeadSource as LeadSource)
      ? (metadataLeadSource as LeadSource)
      : null;

    payload.leadSource = dto.source ?? resolvedLeadSource ?? context.sourceFallback ?? null;
    payload.leadSourceText = metadata.leadSourceText ?? metadata.leadSource ?? payload.leadSource ?? null;

    payload.address = metadata.address ?? (dto as any).address ?? null;
    payload.city = metadata.city ?? (dto as any).city ?? null;
    payload.state = metadata.state ?? metadata.region ?? (dto as any).state ?? null;

    const zipCode =
      metadata.zipCode ??
      metadata.zip_code ??
      metadata.postalCode ??
      metadata.postal_code ??
      (dto as any).zipCode ??
      (dto as any).zip_code ??
      null;
    payload.zipCode = zipCode ?? '00000';

    payload.emergencyContactName = metadata.emergencyContactName ?? metadata.emergency_contact_name ?? null;
    payload.emergencyContactPhone = metadata.emergencyContactPhone ?? metadata.emergency_contact_phone ?? null;

    if (metadata.urgency) {
      payload.urgency = metadata.urgency;
    }

    if (metadata.medicalNotes || metadata.medical_notes) {
      payload.medicalNotes = metadata.medicalNotes ?? metadata.medical_notes;
    }

    // payload.createdBy = context.createdBy ?? null;

    return payload;
  }

  private buildUpdatePayload(updateLeadDto: UpdateLeadDto): Partial<LeadEntity> {
    const payload: Partial<LeadEntity> = {};

    // Map DTO fields to entity fields
    if (updateLeadDto.parentFirstName !== undefined || updateLeadDto.parentLastName !== undefined) {
      const parentFirstName = updateLeadDto.parentFirstName ?? '';
      const parentLastName = updateLeadDto.parentLastName ?? '';
      payload.parentName = `${parentFirstName} ${parentLastName}`.trim() || undefined;
    }

    if (updateLeadDto.email !== undefined) {
      payload.parentEmail = updateLeadDto.email.toLowerCase();
    }

    if (updateLeadDto.phone !== undefined) {
      payload.parentPhone = updateLeadDto.phone;
    }

    if (updateLeadDto.alternatePhone !== undefined) {
      payload.secondaryContactPhone = updateLeadDto.alternatePhone;
    }

    if (updateLeadDto.childFirstName !== undefined || updateLeadDto.childLastName !== undefined) {
      const childFirstName = updateLeadDto.childFirstName ?? '';
      const childLastName = updateLeadDto.childLastName ?? '';
      payload.childName = `${childFirstName} ${childLastName}`.trim() || undefined;
    }

    if (updateLeadDto.childDateOfBirth !== undefined) {
      payload.childBirthdate = updateLeadDto.childDateOfBirth
        ? new Date(updateLeadDto.childDateOfBirth)
        : null;
    }

    // preferredStartDate doesn't exist in database schema

    if (updateLeadDto.followUpDate !== undefined) {
      payload.nextFollowUpAt = updateLeadDto.followUpDate
        ? new Date(updateLeadDto.followUpDate)
        : null;
    }

    if (updateLeadDto.tourDate !== undefined) {
      payload.tourDate = updateLeadDto.tourDate
        ? new Date(updateLeadDto.tourDate)
        : null;
    }

    if (updateLeadDto.programInterest !== undefined) {
      payload.program = updateLeadDto.programInterest;
    }

    if (updateLeadDto.status !== undefined) {
      payload.leadStatus = updateLeadDto.status;
    }

    if (updateLeadDto.source !== undefined) {
      payload.leadSource = updateLeadDto.source;
    }

    // Copy other fields that might match
    if (updateLeadDto.schoolId !== undefined) payload.schoolId = updateLeadDto.schoolId;
    if (updateLeadDto.notes !== undefined) payload.notes = updateLeadDto.notes;
    // internalNotes doesn't exist in database schema
    if (updateLeadDto.assignedTo !== undefined) payload.assignedTo = updateLeadDto.assignedTo;
    // metadata column doesn't exist in database schema

    return payload;
  }

  // mergeMetadata function removed - metadata column doesn't exist in database schema

  private snapshotLead(lead: LeadEntity): Record<string, any> {
    return {
      status: lead.leadStatus,
      assignedTo: lead.assignedTo,
      followUpDate: lead.nextFollowUpAt,
      notes: lead.notes,
      // internalNotes doesn't exist in database schema
      // metadata column doesn't exist in database schema
    };
  }

  private async ensureSchoolExists(schoolId: string): Promise<SchoolEntity> {
    const school = await this.schoolRepository.findOne({ where: { id: schoolId } });

    if (!school) {
      throw new BadRequestException(`School ${schoolId} does not exist`);
    }

    return school;
  }

  private async recordActivity(payload: LeadActivityLogPayload): Promise<void> {
    try {
      const activity = this.leadActivityRepository.create({
        leadId: payload.leadId,
        userId: payload.userId ?? null,
        activityType: payload.activityType,
        oldValue: payload.oldValue ? JSON.stringify(payload.oldValue) : null,
        newValue: payload.newValue ? JSON.stringify(payload.newValue) : null,
        notes: payload.notes ?? null,
        metadata: payload.metadata ?? {},
      });

      await this.leadActivityRepository.save(activity);
    } catch (error: any) {
      this.logger.warn(`Failed to record lead activity for lead ${payload.leadId}: ${error.message}`);
    }
  }

  /**
   * Public method to log a lead activity (for contact interactions)
   */
  async logActivity(
    leadId: string,
    payload: {
      activityType: string;
      notes: string;
      userId?: string | null;
      metadata?: Record<string, any>;
    },
  ): Promise<LeadActivity> {
    const activity = this.leadActivityRepository.create({
      leadId,
      userId: payload.userId ?? null,
      activityType: payload.activityType,
      notes: payload.notes,
      metadata: payload.metadata ?? {},
    });

    const savedActivity = await this.leadActivityRepository.save(activity);

    if (!savedActivity) {
      throw new NotFoundException('Lead activity not found');
    }

    // Load the lead relation for response mapping
    const reloadedActivity = await this.leadActivityRepository.findOne({
      where: { id: savedActivity.id },
      relations: ['lead'],
    });

    return reloadedActivity || savedActivity;
  }

  private emitLeadRealtimeEvent(
    lead: LeadEntity,
    action: LeadRealtimeAction,
    payload?: Record<string, any>,
  ): void {
    try {
      this.realtimeGateway.emitLeadChange({
        action,
        leadId: lead.id,
        schoolId: lead.schoolId,
        payload,
      });
      this.realtimeGateway.emitLeadStatsChange(lead.schoolId);
    } catch (error) {
      this.logger.warn(`Failed to emit realtime event for lead ${lead.id}: ${(error as Error).message}`);
    }
  }

  /**
   * Count leads with optional filtering
   */
  async countLeads(
    status?: LeadStatus,
    schoolId?: string,
    user?: any,
  ): Promise<number> {
    const queryBuilder = this.leadRepository.createQueryBuilder('lead');

    if (status) {
      queryBuilder.where('lead.lead_status = :status', { status });
    }

    // Access control: super admins see all, others see only their school
    if (user?.primaryRole !== 'SUPER_ADMIN' && schoolId) {
      queryBuilder.andWhere('lead.school_id = :schoolId', { schoolId });
    } else if (user?.primaryRole !== 'SUPER_ADMIN' && user?.schoolId) {
      queryBuilder.andWhere('lead.school_id = :schoolId', { schoolId: user.schoolId });
    }

    return queryBuilder.getCount();
  }

  /**
   * Get lead invoices for a school
   */
  async getLeadInvoicesBySchool(
    schoolId: string,
    limit: number = 10,
  ): Promise<LeadInvoice[]> {
    return this.leadInvoiceRepository.find({
      where: { schoolId },
      relations: ['lead'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Send invoice to a lead with enrollment date
   */
  async sendLeadInvoiceWithEnrollment(
    leadId: string,
    amount: number,
    enrollmentDate: string,
    dueDate: string,
    notes: string,
    userId?: string,
  ): Promise<LeadInvoice> {
    const lead = await this.leadRepository.findOne({
      where: { id: leadId },
      relations: ['school'],
    });

    if (!lead) {
      throw new NotFoundException(`Lead with ID "${leadId}" not found`);
    }

    if (!lead.parentEmail) {
      throw new BadRequestException('Lead must have a parent email to send invoice');
    }

    // Generate invoice number
    const invoiceNumber = `LI-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    // Create lead invoice
    const invoice = this.leadInvoiceRepository.create({
      leadId: lead.id,
      schoolId: lead.schoolId,
      parentEmail: lead.parentEmail,
      amount,
      currency: 'usd',
      invoiceNumber,
      status: 'pending',
      dueDate: new Date(dueDate),
      notes,
    });

    const savedInvoice = await this.leadInvoiceRepository.save(invoice);

    // Update lead status to invoice_sent
    lead.leadStatus = LeadStatus.INVOICE_SENT;
    await this.leadRepository.save(lead);

    // Log activity
    await this.logActivity(lead.id, {
      activityType: 'invoice_sent',
      userId: userId ?? null,
      notes: `Invoice ${invoiceNumber} sent for $${amount}. Enrollment date: ${enrollmentDate}`,
      metadata: {
        invoiceId: savedInvoice.id,
        invoiceNumber,
        amount,
        enrollmentDate,
        dueDate,
      },
    });

    // Emit realtime event
    this.emitLeadRealtimeEvent(lead, 'updated', {
      status: LeadStatus.INVOICE_SENT,
      invoiceId: savedInvoice.id,
    });

    return savedInvoice;
  }

  /**
   * Get waitlist queue with positions, sibling info, and capacity data
   */
  async getWaitlistQueue(params: {
    schoolId: string;
    program?: string;
    status?: string;
    assignedTo?: string;
  }): Promise<{
    data: Array<{
      id: string;
      leadId: string;
      schoolId: string;
      program: string;
      waitlistPosition: number;
      priorityScore: number;
      status: string;
      notes: string;
      createdAt: string;
      updatedAt: string;
      programPosition: string;
      availableSpots: number;
      hasSiblings: boolean;
      lead: {
        childName: string;
        parentName: string;
        parentEmail: string;
        parentPhone: string;
        childBirthdate: string;
        assignedTo: string | null;
        leadStatus: string;
        paymentStatus: string;
      };
    }>;
    capacityByProgram: Record<string, { capacity: number; enrolled: number; available: number }>;
  }> {
    const { schoolId, program, status, assignedTo } = params;

    // Get enrolled lead IDs
    const enrolledLeads = await this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .where('enrollment.schoolId = :schoolId', { schoolId })
      .andWhere('enrollment.status = :status', { status: 'active' })
      .select('enrollment.leadId')
      .getRawMany();

    const enrolledLeadIds = enrolledLeads.map((e) => e.enrollment_lead_id);

    // Fetch leads (non-enrolled, active)
    const queryBuilder = this.leadRepository
      .createQueryBuilder('lead')
      .where('lead.schoolId = :schoolId', { schoolId })
      .andWhere('lead.isActive = :isActive', { isActive: true })
      .andWhere('lead.leadStatus != :enrolledStatus', { enrolledStatus: LeadStatus.ENROLLED });

    if (enrolledLeadIds.length > 0) {
      queryBuilder.andWhere('lead.id NOT IN (:...enrolledLeadIds)', { enrolledLeadIds });
    }

    if (program) {
      queryBuilder.andWhere('lead.program = :program', { program });
    }

    if (status) {
      queryBuilder.andWhere('lead.leadStatus = :status', { status });
    }

    if (assignedTo) {
      if (assignedTo === 'none') {
        queryBuilder.andWhere('lead.assignedTo IS NULL');
      } else {
        queryBuilder.andWhere('lead.assignedTo = :assignedTo', { assignedTo });
      }
    }

    const leads = await queryBuilder
      .orderBy('lead.createdAt', 'DESC')
      .getMany();

    // Get class capacity data
    const classes = await this.classRepository.find({
      where: { schoolId },
      select: ['program', 'capacity', 'currentEnrollment'],
    });

    const capacityByProgram: Record<string, { capacity: number; enrolled: number; available: number }> = {};
    classes.forEach((cls) => {
      const prog = cls.program || 'Unknown';
      if (!capacityByProgram[prog]) {
        capacityByProgram[prog] = { capacity: 0, enrolled: 0, available: 0 };
      }
      capacityByProgram[prog].capacity += cls.capacity || 0;
      capacityByProgram[prog].enrolled += cls.currentEnrollment || 0;
    });

    Object.keys(capacityByProgram).forEach((prog) => {
      capacityByProgram[prog].available = Math.max(
        0,
        capacityByProgram[prog].capacity - capacityByProgram[prog].enrolled,
      );
    });

    // Get all parent emails for sibling checking (batch query)
    const parentEmails = [...new Set(leads.map((l) => l.parentEmail).filter(Boolean))];
    const siblingEnrollments = parentEmails.length > 0
      ? await this.enrollmentRepository
          .createQueryBuilder('enrollment')
          .innerJoin('enrollment.lead', 'lead')
          .where('lead.parentEmail IN (:...parentEmails)', { parentEmails })
          .andWhere('enrollment.status = :status', { status: 'active' })
          .andWhere('enrollment.schoolId = :schoolId', { schoolId })
          .select(['lead.parentEmail', 'enrollment.leadId'])
          .getRawMany()
      : [];

    const siblingMap = new Map<string, Set<string>>();
    siblingEnrollments.forEach((se) => {
      const email = se.lead_parent_email;
      const leadId = se.enrollment_lead_id;
      if (!siblingMap.has(email)) {
        siblingMap.set(email, new Set());
      }
      siblingMap.get(email)!.add(leadId);
    });

    // Group leads by program and calculate positions
    const leadsByProgram: Record<string, LeadEntity[]> = {};
    leads.forEach((lead) => {
      const prog = lead.program || 'Unknown';
      if (!leadsByProgram[prog]) {
        leadsByProgram[prog] = [];
      }
      leadsByProgram[prog].push(lead);
    });

    // Sort each program's leads by priority score (desc) then created_at (asc)
    Object.keys(leadsByProgram).forEach((prog) => {
      leadsByProgram[prog].sort((a, b) => {
        const scoreA = a.leadScore || 50;
        const scoreB = b.leadScore || 50;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    });

    // Transform leads data
    const transformedData = leads.map((lead) => {
      const prog = lead.program || 'Unknown';
      const programLeads = leadsByProgram[prog] || [];
      const positionInProgram = programLeads.findIndex((l) => l.id === lead.id) + 1;
      const availableSpots = capacityByProgram[prog]?.available || 0;
      const totalInProgram = programLeads.length;

      // Check for siblings
      const siblingLeadIds = siblingMap.get(lead.parentEmail || '') || new Set();
      const hasSiblings = siblingLeadIds.size > 0 && !siblingLeadIds.has(lead.id);

      return {
        id: `queue-${lead.id}`,
        leadId: lead.id,
        schoolId: lead.schoolId,
        program: prog,
        waitlistPosition: positionInProgram,
        priorityScore: lead.leadScore || 50,
        status:
          lead.leadStatus === LeadStatus.WAITLISTED
            ? 'new'
            : lead.leadStatus === LeadStatus.CONTACTED
              ? 'contacted'
              : lead.leadStatus === LeadStatus.INTERESTED
                ? 'interested'
                : lead.leadStatus === LeadStatus.TOURED
                  ? 'toured'
                  : 'new',
        notes: lead.notes || '',
        createdAt: lead.createdAt.toISOString(),
        updatedAt: lead.updatedAt.toISOString(),
        programPosition:
          availableSpots === 0 && totalInProgram === 0
            ? 'No classes'
            : `${positionInProgram} of ${totalInProgram}`,
        availableSpots,
        hasSiblings,
        lead: {
          childName: lead.childName || 'N/A',
          parentName: lead.parentName || 'N/A',
          parentEmail: lead.parentEmail || '',
          parentPhone: lead.parentPhone || '',
          childBirthdate: lead.childBirthdate instanceof Date 
            ? lead.childBirthdate.toISOString().split('T')[0] 
            : lead.childBirthdate 
              ? String(lead.childBirthdate) 
              : '',
          assignedTo: lead.assignedTo || null,
          leadStatus: lead.leadStatus,
          paymentStatus: lead.paymentStatus || 'pending',
        },
      };
    });

    return {
      data: transformedData,
      capacityByProgram,
    };
  }

  /**
   * Get interactions for a lead
   */
  async getLeadInteractions(leadId: string): Promise<LeadInteraction[]> {
    const interactions = await this.leadInteractionRepository.find({
      where: { leadId },
      order: { interactionDate: 'DESC' },
      relations: ['lead'],
    });

    return interactions;
  }

  /**
   * Create a new interaction for a lead
   */
  async createLeadInteraction(
    leadId: string,
    dto: CreateLeadInteractionDto,
    userId: string,
  ): Promise<LeadInteraction> {
    const lead = await this.findOne(leadId);

    const interaction = this.leadInteractionRepository.create({
      leadId,
      userId,
      interactionType: dto.interaction_type,
      subject: dto.subject || null,
      content: dto.content,
      interactionDate: new Date(),
    });

    const saved = await this.leadInteractionRepository.save(interaction);

    // Update lead's last activity
    await this.leadRepository.update(leadId, {
      lastActivityAt: new Date(),
    });

    return saved;
  }

  /**
   * Get documents for a lead (by student_id which is the lead_id)
   */
  async getLeadDocuments(leadId: string): Promise<StudentDocument[]> {
    const documents = await this.studentDocumentRepository.find({
      where: { studentId: leadId },
      order: { createdAt: 'DESC' },
    });

    return documents;
  }

  /**
   * Get missing required documents for a lead
   */
  async getMissingDocuments(leadId: string): Promise<string[]> {
    const REQUIRED_DOCUMENTS = [
      'Birth Certificate',
      'Immunization Records',
      'Emergency Contact Form',
      'Medical Information Form',
      'Photo ID',
    ];

    const documents = await this.getLeadDocuments(leadId);
    const uploadedTypes = documents.map((doc) => doc.documentType);
    const missing = REQUIRED_DOCUMENTS.filter((doc) => !uploadedTypes.includes(doc));

    return missing;
  }

  /**
   * Get assignable staff members for a school
   */
  async getAssignableStaff(schoolId: string): Promise<any[]> {
    // Get user roles for school_admin and admissions_staff using QueryBuilder to avoid relation loading
    const userRoles = await this.userRoleRepository
      .createQueryBuilder('ur')
      .select(['ur.userId', 'ur.role'])
      .where('ur.schoolId = :schoolId', { schoolId })
      .andWhere('ur.role IN (:...roles)', { roles: [AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF] })
      .getMany();

    const userIds = userRoles.map((ur) => ur.userId).filter(Boolean);

    if (userIds.length === 0) {
      return [];
    }

    // Get profiles for these users
    const profiles = await this.profileRepository.find({
      where: { id: In(userIds) },
    });

    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    // Merge roles with profiles
    return userRoles.map((ur) => {
      const profile = profileMap.get(ur.userId);
      return {
        user_id: ur.userId,
        first_name: profile?.firstName || null,
        last_name: profile?.lastName || null,
        email: profile?.email || null,
        role: ur.role,
      };
    });
  }

  /**
   * Update lead details (status, urgency, rating, assignment, follow-up date)
   */
  async updateLeadDetails(
    leadId: string,
    dto: UpdateLeadDetailsDto,
    userId: string,
  ): Promise<LeadEntity> {
    const lead = await this.findOne(leadId);

    const updateData: Partial<LeadEntity> = {};

    if (dto.lead_status !== undefined) {
      updateData.leadStatus = dto.lead_status;
    }
    if (dto.urgency !== undefined) {
      updateData.urgency = dto.urgency;
    }
    if (dto.lead_rating !== undefined) {
      updateData.leadRating = dto.lead_rating;
    }
    if (dto.assigned_to !== undefined) {
      updateData.assignedTo = dto.assigned_to;
    }
    if (dto.follow_up_date !== undefined) {
      updateData.followUpDate = dto.follow_up_date ? new Date(dto.follow_up_date) : null;
    }

    await this.leadRepository.update(leadId, updateData);

    // Log activity for status changes
    if (dto.lead_status && dto.lead_status !== lead.leadStatus) {
      await this.leadInteractionRepository.save({
        leadId,
        userId,
        interactionType: 'status_change',
        subject: 'Status Updated',
        content: `Status changed from ${lead.leadStatus} to ${dto.lead_status}`,
        interactionDate: new Date(),
      } as LeadInteraction);
    }

    return this.findOne(leadId);
  }

  /**
   * Convert lead to student
   */
  async convertLeadToStudent(
    leadId: string,
    dto: ConvertLeadDto,
    userId: string,
  ): Promise<{ studentId: string; enrollmentId: string }> {
    const lead = await this.findOne(leadId);

    if (lead.leadStatus === LeadStatus.CONVERTED) {
      throw new BadRequestException('Lead is already converted');
    }

    // Use the SQL function to convert
    const result = await this.dataSource.query(
      `SELECT convert_lead_to_student($1, $2, $3) as student_id`,
      [leadId, dto.program || null, null],
    );

    const studentId = result[0]?.student_id;

    if (!studentId) {
      throw new BadRequestException('Failed to convert lead to student');
    }

    // Find the enrollment that was created
    const enrollment = await this.enrollmentRepository.findOne({
      where: { leadId },
      order: { createdAt: 'DESC' },
    });

    if (!enrollment) {
      throw new BadRequestException('Enrollment not found after conversion');
    }

    return {
      studentId,
      enrollmentId: enrollment.id,
    };
  }
}