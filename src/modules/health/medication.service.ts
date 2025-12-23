import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, And } from 'typeorm';
import { MedicationAuthorization, AuthorizationStatus } from './entities/medication-authorization.entity';
import { MedicationLog, AdministrationStatus } from './entities/medication-log.entity';
import { Student } from '../students/entities/student.entity';
import { ProfileEntity } from '../users/entities/profile.entity';
import { SchoolEntity } from '../schools/entities/school.entity';
import { CreateMedicationAuthorizationDto } from './dto/create-medication-authorization.dto';
import { ApproveMedicationDto } from './dto/approve-medication.dto';
import { LogMedicationDto } from './dto/log-medication.dto';
import { CommunicationsService } from '../communications/communications.service';
import { AppRole } from '../../common/enums/app-role.enum';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

@Injectable()
export class MedicationService {
  private readonly logger = new Logger(MedicationService.name);

  constructor(
    @InjectRepository(MedicationAuthorization)
    private readonly authorizationRepository: Repository<MedicationAuthorization>,
    @InjectRepository(MedicationLog)
    private readonly medicationLogRepository: Repository<MedicationLog>,
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @InjectRepository(ProfileEntity)
    private readonly profileRepository: Repository<ProfileEntity>,
    @InjectRepository(SchoolEntity)
    private readonly schoolRepository: Repository<SchoolEntity>,
    private readonly communicationsService: CommunicationsService,
  ) {}

  /**
   * Create medication authorization request
   */
  async createAuthorization(
    dto: CreateMedicationAuthorizationDto,
    userId: string,
    schoolId: string,
  ): Promise<MedicationAuthorization> {
    // Verify student exists and belongs to school
    const student = await this.studentRepository.findOne({
      where: { id: dto.studentId, schoolId },
    });

    if (!student) {
      throw new NotFoundException('Student not found or not enrolled in this school');
    }

    // Verify user is parent of the student
    const parentStudent = await this.profileRepository
      .createQueryBuilder('profile')
      .innerJoin('parent_students', 'ps', 'ps.parent_id = profile.id')
      .where('profile.id = :userId', { userId })
      .andWhere('ps.student_id = :studentId', { studentId: dto.studentId })
      .getOne();

    if (!parentStudent) {
      throw new ForbiddenException('You can only create medication authorizations for your own children');
    }

    // Check for overlapping active authorizations for the same medication
    const existingAuth = await this.authorizationRepository.findOne({
      where: {
        studentId: dto.studentId,
        medicationName: dto.medicationName,
        status: AuthorizationStatus.APPROVED,
      },
    });

    if (existingAuth) {
      const endDate = existingAuth.endDate ? new Date(existingAuth.endDate) : null;
      const startDate = new Date(existingAuth.startDate);
      const newStartDate = new Date(dto.startDate);
      const newEndDate = dto.endDate ? new Date(dto.endDate) : null;

      // Check for overlap
      if (
        (!endDate || newStartDate <= endDate) &&
        (!newEndDate || startDate <= newEndDate)
      ) {
        throw new BadRequestException(
          'An active authorization for this medication already exists for this student',
        );
      }
    }

    const authorization = this.authorizationRepository.create({
      studentId: dto.studentId,
      parentId: userId,
      schoolId,
      medicationName: dto.medicationName,
      dosage: dto.dosage,
      administrationTimes: dto.administrationTimes,
      startDate: new Date(dto.startDate),
      endDate: dto.endDate ? new Date(dto.endDate) : null,
      specialInstructions: dto.specialInstructions || null,
      doctorNoteUrl: dto.doctorNoteUrl || null,
      prescriptionUrl: dto.prescriptionUrl || null,
      status: AuthorizationStatus.PENDING,
    });

    return this.authorizationRepository.save(authorization);
  }

  /**
   * Approve or reject medication authorization
   */
  async approveAuthorization(
    id: string,
    dto: ApproveMedicationDto,
    userId: string,
    userRoles: AppRole[],
  ): Promise<MedicationAuthorization> {
    const authorization = await this.authorizationRepository.findOne({
      where: { id },
      relations: ['student', 'parent', 'school'],
    });

    if (!authorization) {
      throw new NotFoundException('Medication authorization not found');
    }

    // Verify user has permission (admin or owner)
    const hasPermission = userRoles.some((role) =>
      [AppRole.SCHOOL_ADMIN, AppRole.SCHOOL_OWNER, AppRole.SUPER_ADMIN].includes(role),
    );

    if (!hasPermission) {
      throw new ForbiddenException('You do not have permission to approve medication authorizations');
    }

    const status = dto.status || AuthorizationStatus.APPROVED;

    if (status === AuthorizationStatus.APPROVED) {
      authorization.status = AuthorizationStatus.APPROVED;
      authorization.approvedBy = userId;
      authorization.approvedAt = new Date();
      authorization.rejectionReason = null;
    } else if (status === AuthorizationStatus.REJECTED) {
      authorization.status = AuthorizationStatus.REJECTED;
      authorization.approvedBy = userId;
      authorization.approvedAt = new Date();
      authorization.rejectionReason = dto.rejectionReason || 'No reason provided';
    }

    return this.authorizationRepository.save(authorization);
  }

  /**
   * Get medication authorizations
   */
  async getAuthorizations(
    studentId: string | undefined,
    schoolId: string | undefined,
    userId: string,
    userRoles: AppRole[],
  ): Promise<MedicationAuthorization[]> {
    const where: FindOptionsWhere<MedicationAuthorization> = {};

    if (studentId) {
      where.studentId = studentId;
    }

    if (schoolId) {
      where.schoolId = schoolId;
    } else {
      const userProfile = await this.profileRepository.findOne({
        where: { id: userId },
        relations: ['roles'],
      });

      if (userProfile?.roles && userProfile.roles.length > 0) {
        const schoolRole = userProfile.roles.find(
          (r) => r.schoolId !== null && r.role !== AppRole.SUPER_ADMIN,
        );
        if (schoolRole?.schoolId) {
          where.schoolId = schoolRole.schoolId;
        }
      }
    }

    const queryBuilder = this.authorizationRepository
      .createQueryBuilder('auth')
      .leftJoinAndSelect('auth.student', 'student')
      .leftJoinAndSelect('auth.parent', 'parent')
      .leftJoinAndSelect('auth.approvedByUser', 'approvedByUser')
      .leftJoinAndSelect('auth.school', 'school')
      .where(where);

    // If parent, only show their children's authorizations
    if (userRoles.includes(AppRole.PARENT) && !userRoles.includes(AppRole.SCHOOL_ADMIN)) {
      queryBuilder
        .innerJoin('parent_students', 'ps', 'ps.student_id = auth.student_id')
        .andWhere('ps.parent_id = :userId', { userId });
    }

    return queryBuilder.orderBy('auth.createdAt', 'DESC').getMany();
  }

  /**
   * Log medication administration
   */
  async logMedication(
    dto: LogMedicationDto,
    userId: string,
    userRoles: AppRole[],
  ): Promise<MedicationLog> {
    // Verify user has permission (teacher, admin, owner)
    const hasPermission = userRoles.some((role) =>
      [AppRole.TEACHER, AppRole.SCHOOL_ADMIN, AppRole.SCHOOL_OWNER].includes(role),
    );

    if (!hasPermission) {
      throw new ForbiddenException('You do not have permission to log medication administration');
    }

    // Get authorization
    const authorization = await this.authorizationRepository.findOne({
      where: { id: dto.authorizationId },
      relations: ['student', 'school'],
    });

    if (!authorization) {
      throw new NotFoundException('Medication authorization not found');
    }

    // Verify authorization is approved
    if (authorization.status !== AuthorizationStatus.APPROVED) {
      throw new BadRequestException('Medication authorization is not approved');
    }

    // Verify authorization is active (within date range)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(authorization.startDate);
    startDate.setHours(0, 0, 0, 0);

    if (today < startDate) {
      throw new BadRequestException('Medication authorization has not started yet');
    }

    if (authorization.endDate) {
      const endDate = new Date(authorization.endDate);
      endDate.setHours(23, 59, 59, 999);

      if (today > endDate) {
        throw new BadRequestException('Medication authorization has expired');
      }
    }

    // Verify dosage matches
    if (dto.dosage !== authorization.dosage) {
      throw new BadRequestException(
        `Dosage mismatch. Expected: ${authorization.dosage}, Provided: ${dto.dosage}`,
      );
    }

    // Get user's school
    const userProfile = await this.profileRepository.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    const schoolRole = userProfile?.roles.find(
      (r) => r.schoolId === authorization.schoolId && r.schoolId !== null,
    );

    if (!schoolRole) {
      throw new ForbiddenException('You do not have access to this school');
    }

    const medicationLog = this.medicationLogRepository.create({
      authorizationId: dto.authorizationId,
      studentId: authorization.studentId,
      administeredBy: userId,
      schoolId: authorization.schoolId,
      administrationTime: new Date(dto.administrationTime),
      dosage: dto.dosage,
      notes: dto.notes || null,
      photoUrl: dto.photoUrl || null,
      status: dto.status || AdministrationStatus.ADMINISTERED,
    });

    const savedLog = await this.medicationLogRepository.save(medicationLog);

    // Send notification to parent
    await this.sendMedicationNotification(savedLog, authorization.student);

    return savedLog;
  }

  /**
   * Get medication logs
   */
  async getMedicationLogs(
    studentId: string | undefined,
    authorizationId: string | undefined,
    schoolId: string | undefined,
    userId: string,
    userRoles: AppRole[],
  ): Promise<MedicationLog[]> {
    const where: FindOptionsWhere<MedicationLog> = {};

    if (studentId) {
      where.studentId = studentId;
    }

    if (authorizationId) {
      where.authorizationId = authorizationId;
    }

    if (schoolId) {
      where.schoolId = schoolId;
    } else {
      const userProfile = await this.profileRepository.findOne({
        where: { id: userId },
        relations: ['roles'],
      });

      if (userProfile?.roles && userProfile.roles.length > 0) {
        const schoolRole = userProfile.roles.find(
          (r) => r.schoolId !== null && r.role !== AppRole.SUPER_ADMIN,
        );
        if (schoolRole?.schoolId) {
          where.schoolId = schoolRole.schoolId;
        }
      }
    }

    const queryBuilder = this.medicationLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.authorization', 'authorization')
      .leftJoinAndSelect('log.student', 'student')
      .leftJoinAndSelect('log.administeredByUser', 'administeredByUser')
      .leftJoinAndSelect('log.school', 'school')
      .where(where);

    // If parent, only show their children's logs
    if (userRoles.includes(AppRole.PARENT) && !userRoles.includes(AppRole.SCHOOL_ADMIN)) {
      queryBuilder
        .innerJoin('parent_students', 'ps', 'ps.student_id = log.student_id')
        .andWhere('ps.parent_id = :userId', { userId });
    }

    return queryBuilder.orderBy('log.administrationTime', 'DESC').getMany();
  }

  /**
   * Send notification to parent about medication administration
   */
  private async sendMedicationNotification(
    log: MedicationLog,
    student: Student,
  ): Promise<void> {
    try {
      if (!student.parentEmail) {
        this.logger.warn(`No parent email for student ${student.id}`);
        return;
      }

      const parentProfile = await this.profileRepository.findOne({
        where: { email: student.parentEmail },
        select: ['id'],
      });

      if (!parentProfile) {
        this.logger.warn(`Parent profile not found for email ${student.parentEmail}`);
        return;
      }

      const administeredByUser = await this.profileRepository.findOne({
        where: { id: log.administeredBy },
        select: ['firstName', 'lastName'],
      });

      const administeredByName = administeredByUser
        ? `${administeredByUser.firstName || ''} ${administeredByUser.lastName || ''}`.trim()
        : 'Staff member';

      const authorization = await this.authorizationRepository.findOne({
        where: { id: log.authorizationId },
        select: ['medicationName'],
      });

      let message = `${student.firstName} ${student.lastName} received medication on ${log.administrationTime.toLocaleString()}.\n\n`;
      message += `Medication: ${authorization?.medicationName || 'Unknown'}\n`;
      message += `Dosage: ${log.dosage}\n`;
      message += `Administered by: ${administeredByName}\n`;

      if (log.notes) {
        message += `Notes: ${log.notes}\n`;
      }

      if (log.status === AdministrationStatus.MISSED) {
        message += `\n⚠️ Status: MISSED - Medication was not administered.`;
      } else if (log.status === AdministrationStatus.REFUSED) {
        message += `\n⚠️ Status: REFUSED - Student refused to take medication.`;
      }

      await this.communicationsService.sendParentMessage(log.administeredBy, {
        recipientId: parentProfile.id,
        studentId: student.id,
        subject: `Medication Administered: ${authorization?.medicationName || 'Medication'}`,
        content: message,
        channel: 'email',
        messageType: 'medication_log' as any,
      });

      // Update log as notified
      log.parentNotified = true;
      await this.medicationLogRepository.save(log);

      this.logger.log(`Medication notification sent to ${student.parentEmail}`);
    } catch (error) {
      this.logger.error(`Failed to send medication notification: ${error.message}`, error.stack);
      // Don't fail the request if notification fails
    }
  }
}







