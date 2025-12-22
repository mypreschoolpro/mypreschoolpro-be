import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Waitlist } from '../enrollment/entities/waitlist.entity';
import { EnrollmentEntity, EnrollmentStatus } from '../enrollment/entities/enrollment.entity';
import { SchoolEntity } from '../schools/entities/school.entity';
import { WaitlistQueryDto } from './dto/waitlist-query.dto';
import {
  WaitlistLeadDto,
  WaitlistPaginationDto,
  WaitlistResponseDto,
  WaitlistSchoolDto,
  WaitlistStatsDto,
} from './dto/waitlist-response.dto';
import { LeadStatusType } from '../../common/enums/lead-status-type.enum';
import { UpdateWaitlistPositionDto } from './dto/update-waitlist-position.dto';
import { UpdateWaitlistStatusDto } from './dto/update-waitlist-status.dto';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { AppRole } from '../../common/enums/app-role.enum';
import { ParentWaitlistEntryDto } from './dto/parent-waitlist-entry.dto';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectRepository(Waitlist)
    private readonly waitlistRepository: Repository<Waitlist>,
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentRepository: Repository<EnrollmentEntity>,
    @InjectRepository(SchoolEntity)
    private readonly schoolRepository: Repository<SchoolEntity>,
  ) { }

  async getWaitlist(user: AuthUser, query: WaitlistQueryDto): Promise<WaitlistResponseDto> {
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 100;
    const take = Math.min(limit || 100, 500);
    const skip = (page - 1) * take;

    const queryBuilder = this.waitlistRepository
      .createQueryBuilder('waitlist')
      .leftJoinAndSelect('waitlist.lead', 'lead')
      .leftJoinAndSelect('waitlist.school', 'school');

    const schoolIdFilters = await this.resolveSchoolFilters(user, query.schoolId, query.schoolIds);
    if (schoolIdFilters && schoolIdFilters.length > 0) {
      if (schoolIdFilters.length === 1) {
        queryBuilder.andWhere('waitlist.school_id = :schoolId', { schoolId: schoolIdFilters[0] });
      } else {
        queryBuilder.andWhere('waitlist.school_id IN (:...schoolIds)', { schoolIds: schoolIdFilters });
      }
    }

    if (query.program) {
      queryBuilder.andWhere('waitlist.program ILIKE :program', { program: `%${query.program}%` });
    }

    if (query.status) {
      queryBuilder.andWhere('waitlist.status = :status', { status: query.status });
    }

    if (query.search) {
      queryBuilder.andWhere(
        '(lead.child_name ILIKE :search OR lead.parent_name ILIKE :search OR lead.parent_email ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    const sortOrder = (query.sortOrder || 'asc').toUpperCase() as 'ASC' | 'DESC';
    switch (query.sortBy) {
      case 'priority':
        queryBuilder
          .orderBy('waitlist.priorityScore', sortOrder)
          .addOrderBy('waitlist.waitlistPosition', 'ASC');
        break;
      case 'date':
        queryBuilder.orderBy('waitlist.createdAt', sortOrder);
        break;
      default:
        queryBuilder.orderBy('waitlist.waitlistPosition', sortOrder);
    }

    queryBuilder.skip(skip).take(take);

    const [entries, total] = await queryBuilder.getManyAndCount();

    const waitlist = await this.mapWaitlistEntries(entries);
    const schools = this.buildSchoolSummary(waitlist);
    const stats = this.buildStats(total, schools);

    const pagination: WaitlistPaginationDto = {
      page,
      limit: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };

    return {
      waitlist,
      schools,
      stats,
      pagination,
    };
  }

  async countWaitlist(
    status?: string,
    schoolId?: string,
    user?: AuthUser,
  ): Promise<number> {
    const queryBuilder = this.waitlistRepository.createQueryBuilder('waitlist');

    if (status) {
      queryBuilder.where('waitlist.status = :status', { status });
    }

    // Access control: super admins see all, school owners see their schools, others see their school
    if (user?.primaryRole === AppRole.SCHOOL_OWNER) {
      const ownedSchools = await this.schoolRepository.find({
        where: { ownerId: user.id },
        select: ['id'],
      });
      const ownedSchoolIds = ownedSchools.map(s => s.id);
      if (ownedSchoolIds.length > 0) {
        queryBuilder.andWhere('waitlist.schoolId IN (:...schoolIds)', {
          schoolIds: ownedSchoolIds,
        });
      } else {
        return 0;
      }
    } else if (schoolId) {
      queryBuilder.andWhere('waitlist.schoolId = :schoolId', { schoolId });
    } else if (user?.primaryRole !== AppRole.SUPER_ADMIN && user?.schoolId) {
      queryBuilder.andWhere('waitlist.schoolId = :schoolId', { schoolId: user.schoolId });
    }

    return queryBuilder.getCount();
  }

  async getParentWaitlist(user: AuthUser): Promise<ParentWaitlistEntryDto[]> {
    if (!user.email) {
      throw new BadRequestException('Parent email is required to view waitlist information');
    }

    const entries = await this.waitlistRepository
      .createQueryBuilder('waitlist')
      .leftJoinAndSelect('waitlist.lead', 'lead')
      .leftJoinAndSelect('waitlist.school', 'school')
      .where('LOWER(lead.parent_email) = LOWER(:email)', { email: user.email })
      .orderBy('waitlist.priority_score', 'DESC')
      .addOrderBy('waitlist.created_at', 'ASC')
      .getMany();

    if (!entries.length) {
      return [];
    }

    const filteredByLeadStatus = entries.filter((entry) => {
      const leadStatus = (entry.lead?.leadStatus as string | undefined)?.toLowerCase();
      return !['enrolled', 'registered'].includes(leadStatus ?? '');
    });

    const activeEnrollmentLeadIds = await this.fetchActiveEnrollmentLeadIds(
      filteredByLeadStatus.map((entry) => entry.leadId).filter((leadId): leadId is string => Boolean(leadId)),
    );

    const visibleEntries = filteredByLeadStatus.filter((entry) => !activeEnrollmentLeadIds.has(entry.leadId));

    const sortedEntries = [...visibleEntries].sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      const aDate = a.createdAt ? a.createdAt.getTime() : 0;
      const bDate = b.createdAt ? b.createdAt.getTime() : 0;
      return aDate - bDate;
    });

    const positionMap = new Map<string, number>();

    return sortedEntries.map((entry) => {
      const key = `${entry.schoolId ?? 'unknown'}:${entry.program ?? 'unknown'}`;
      let position = entry.waitlistPosition || 0;
      if (!this.isTerminalWaitlistStatus(entry.status)) {
        const nextPosition = (positionMap.get(key) || 0) + 1;
        positionMap.set(key, nextPosition);
        position = nextPosition;
      }

      const priority = this.resolvePriorityLabel(entry.priorityScore || 0);
      const estimatedTime = this.estimateWaitTime(position);

      return {
        id: entry.id,
        childName: entry.lead?.childName || 'Unknown Child',
        program: entry.program,
        schoolId: entry.schoolId,
        school: entry.school?.name || 'Unknown School',
        position,
        status: this.formatParentFacingStatus(entry.status),
        priority,
        priorityScore: entry.priorityScore ?? 0,
        dateApplied: entry.createdAt?.toISOString() ?? '',
        estimatedTime,
        lastUpdated: entry.updatedAt?.toISOString() ?? '',
        notes: entry.notes || entry.lead?.notes || null,
        siblingEnrolled: entry.priorityScore >= 50,
        tourScheduled: entry.offerDate ? entry.offerDate.toISOString() : null,
      };
    });
  }

  async updateStatus(
    waitlistId: string,
    payload: UpdateWaitlistStatusDto,
  ): Promise<void> {
    const waitlistEntry = await this.waitlistRepository.findOne({
      where: { id: waitlistId },
      relations: ['lead'],
    });

    if (!waitlistEntry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    waitlistEntry.status = payload.status;
    await this.waitlistRepository.save(waitlistEntry);
  }

  async updatePosition(
    waitlistId: string,
    payload: UpdateWaitlistPositionDto,
  ): Promise<void> {
    const waitlistEntry = await this.waitlistRepository.findOne({
      where: { id: waitlistId },
      select: ['id', 'waitlistPosition', 'schoolId', 'program'],
    });

    if (!waitlistEntry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    const oldPosition = waitlistEntry.waitlistPosition;
    const newPosition = payload.position;

    if (oldPosition === newPosition) {
      return;
    }

    await this.waitlistRepository.manager.transaction(async (transactionalEntityManager) => {
      if (newPosition < oldPosition) {
        // Moving UP: increment positions of entries between newPosition and oldPosition-1
        await transactionalEntityManager
          .createQueryBuilder()
          .update(Waitlist)
          .set({ waitlistPosition: () => 'waitlist_position + 1' })
          .where('school_id = :schoolId', { schoolId: waitlistEntry.schoolId })
          .andWhere('program = :program', { program: waitlistEntry.program })
          .andWhere('waitlist_position >= :newPosition', { newPosition })
          .andWhere('waitlist_position < :oldPosition', { oldPosition })
          .execute();
      } else {
        // Moving DOWN: decrement positions of entries between oldPosition+1 and newPosition
        await transactionalEntityManager
          .createQueryBuilder()
          .update(Waitlist)
          .set({ waitlistPosition: () => 'waitlist_position - 1' })
          .where('school_id = :schoolId', { schoolId: waitlistEntry.schoolId })
          .andWhere('program = :program', { program: waitlistEntry.program })
          .andWhere('waitlist_position > :oldPosition', { oldPosition })
          .andWhere('waitlist_position <= :newPosition', { newPosition })
          .execute();
      }

      // Finally update the entry's position
      await transactionalEntityManager.update(Waitlist, waitlistId, {
        waitlistPosition: newPosition,
      });

      // Normalize positions to ensure no gaps
      const allEntries = await transactionalEntityManager
        .createQueryBuilder(Waitlist, 'waitlist')
        .where('school_id = :schoolId', { schoolId: waitlistEntry.schoolId })
        .andWhere('program = :program', { program: waitlistEntry.program })
        .orderBy('waitlist.waitlist_position', 'ASC')
        .addOrderBy('waitlist.created_at', 'ASC')
        .getMany();

      for (let i = 0; i < allEntries.length; i++) {
        if (allEntries[i].waitlistPosition !== (i + 1)) {
          await transactionalEntityManager.update(Waitlist, allEntries[i].id, {
            waitlistPosition: i + 1,
          });
        }
      }
    });
  }

  async updateEntry(
    waitlistId: string,
    payload: { notes?: string; priorityScore?: number },
  ): Promise<void> {
    const waitlistEntry = await this.waitlistRepository.findOne({ where: { id: waitlistId } });

    if (!waitlistEntry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    if (payload.notes !== undefined) {
      waitlistEntry.notes = payload.notes;
    }
    if (payload.priorityScore !== undefined) {
      // Convert from 1-10 scale (UI) to 0-100 scale (database)
      waitlistEntry.priorityScore = payload.priorityScore * 10;
    }

    await this.waitlistRepository.save(waitlistEntry);
  }

  async enrollLead(waitlistId: string): Promise<void> {
    const waitlistEntry = await this.waitlistRepository.findOne({
      where: { id: waitlistId },
      relations: ['lead', 'school'],
    });

    if (!waitlistEntry || !waitlistEntry.lead) {
      throw new NotFoundException('Waitlist entry not found');
    }

    waitlistEntry.status = LeadStatusType.DECLINED;
    await this.waitlistRepository.save(waitlistEntry);
  }

  private async resolveSchoolFilters(user: AuthUser, requestedSchoolId?: string, requestedSchoolIds?: string): Promise<string[] | undefined> {
    if (user.primaryRole === AppRole.SUPER_ADMIN) {
      if (requestedSchoolIds) {
        return requestedSchoolIds.split(',').map(id => id.trim()).filter(Boolean);
      }
      return requestedSchoolId ? [requestedSchoolId] : undefined;
    }

    // Get all accessible school IDs for the user
    const accessibleSchoolIds = new Set<string>();

    console.log(user.primaryRole, AppRole.SCHOOL_OWNER, "Role Identification");


    // For school owners, query all schools they own
    if (user.primaryRole === AppRole.SCHOOL_OWNER) {
      const ownedSchools = await this.schoolRepository.find({
        where: { ownerId: user.id },
        select: ['id'],
      });
      ownedSchools.forEach(school => accessibleSchoolIds.add(school.id));
    } else {
      // For other roles, use schoolId and roles
      if (user.schoolId) {
        accessibleSchoolIds.add(user.schoolId);
      }
      user.roles?.forEach((role) => {
        if (role.schoolId) {
          accessibleSchoolIds.add(role.schoolId);
        }
      });
    }

    if (accessibleSchoolIds.size === 0) {
      throw new UnauthorizedException('User does not have a school assigned');
    }

    // For school owners, if no specific school requested, return all owned schools
    if (user.primaryRole === AppRole.SCHOOL_OWNER && !requestedSchoolId && !requestedSchoolIds) {
      return Array.from(accessibleSchoolIds);
    }

    // If specific school(s) requested, validate access
    if (requestedSchoolIds) {
      const requestedIds = requestedSchoolIds.split(',').map(id => id.trim()).filter(Boolean);
      const validIds = requestedIds.filter(id => accessibleSchoolIds.has(id));
      if (validIds.length === 0) {
        throw new ForbiddenException('You do not have access to the requested schools');
      }
      return validIds;
    }

    if (requestedSchoolId) {
      if (!accessibleSchoolIds.has(requestedSchoolId)) {
        throw new ForbiddenException('You do not have access to the requested school');
      }
      return [requestedSchoolId];
    }

    // Default: return all accessible schools
    return Array.from(accessibleSchoolIds);
  }

  private async mapWaitlistEntries(entries: Waitlist[]): Promise<WaitlistLeadDto[]> {
    const leadIds = entries.map((entry) => entry.leadId).filter(Boolean);
    const activeEnrollmentLeads = await this.fetchActiveEnrollmentLeadIds(leadIds);

    return entries.map((entry) => {
      const lead = entry.lead;
      const school = entry.school;
      const priorityLabel = entry.priorityScore >= 80 ? 'High' : entry.priorityScore >= 50 ? 'Medium' : 'Standard';

      // Convert priorityScore from 0-100 scale to 1-10 scale for UI
      const priorityScoreForUI = entry.priorityScore ? Math.round(entry.priorityScore / 10) : 0;
      const normalizedPriorityScore = priorityScoreForUI > 0 ? priorityScoreForUI : 1;

      return {
        id: entry.id,
        childName: lead?.childName || 'Unknown Child',
        parentName: lead?.parentName || 'Unknown Parent',
        email: lead?.parentEmail || '',
        phone: lead?.parentPhone || '',
        program: entry.program,
        school: school?.name || 'Unknown School',
        schoolId: entry.schoolId,
        position: entry.waitlistPosition,
        status: entry.status,
        priority: priorityLabel,
        priorityScore: normalizedPriorityScore,
        dateAdded: entry.createdAt?.toISOString() ?? '',
        lastUpdated: entry.updatedAt?.toISOString() ?? '',
        siblingEnrolled: activeEnrollmentLeads.has(entry.leadId),
        notes: entry.notes || lead?.notes || '',
      };
    });
  }

  private buildSchoolSummary(waitlist: WaitlistLeadDto[]): WaitlistSchoolDto[] {
    const map = new Map<string, WaitlistSchoolDto>();

    waitlist.forEach((entry) => {
      if (!map.has(entry.schoolId)) {
        map.set(entry.schoolId, {
          id: entry.schoolId,
          name: entry.school,
          totalWaitlist: 0,
          programBreakdown: [],
        });
      }

      const school = map.get(entry.schoolId)!;
      school.totalWaitlist += 1;

      const programBreakdown = school.programBreakdown.find((p) => p.program === entry.program);
      if (programBreakdown) {
        programBreakdown.count += 1;
      } else {
        school.programBreakdown.push({ program: entry.program, count: 1 });
      }
    });

    return Array.from(map.values());
  }

  private buildStats(totalWaitlisted: number, schools: WaitlistSchoolDto[]): WaitlistStatsDto {
    return {
      totalWaitlisted,
      totalSchools: schools.length,
      avgWaitTime: '—',
      conversionRate: '—',
    };
  }

  private async fetchActiveEnrollmentLeadIds(leadIds: string[]): Promise<Set<string>> {
    if (!leadIds.length) {
      return new Set<string>();
    }

    const records = await this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .select('enrollment.lead_id', 'leadId')
      .where('enrollment.lead_id IN (:...leadIds)', { leadIds })
      .andWhere('enrollment.status IN (:...statuses)', {
        statuses: [EnrollmentStatus.ACTIVE],
      })
      .getRawMany();

    return new Set(records.map((record) => record.leadId).filter(Boolean));
  }

  private resolvePriorityLabel(priorityScore: number): string {
    if (priorityScore >= 100) {
      return 'High';
    }
    if (priorityScore >= 50) {
      return 'Sibling';
    }
    return 'Standard';
  }

  private estimateWaitTime(position: number): string {
    if (position <= 3) return '1-2 weeks';
    if (position <= 6) return '2-4 weeks';
    if (position <= 10) return '1-2 months';
    return '2-3 months';
  }

  private formatParentFacingStatus(status: LeadStatusType | string): string {
    const normalized = typeof status === 'string' ? status.toLowerCase() : status;
    switch (normalized) {
      case LeadStatusType.CONTACTED:
      case 'contacted':
        return 'Contacted';
      case LeadStatusType.INTERESTED:
      case 'interested':
        return 'Interested';
      case LeadStatusType.TOURED:
      case 'toured':
        return 'Toured';
      case LeadStatusType.ENROLLED:
      case 'enrolled':
        return 'Enrolled';
      case LeadStatusType.DECLINED:
      case 'declined':
        return 'Declined';
      default:
        return 'Waitlisted';
    }
  }

  private isTerminalWaitlistStatus(status: LeadStatusType | string): boolean {
    const normalized = typeof status === 'string' ? status.toLowerCase() : status;
    return normalized === LeadStatusType.DECLINED || normalized === LeadStatusType.ENROLLED || normalized === 'declined' || normalized === 'enrolled';
  }

}


