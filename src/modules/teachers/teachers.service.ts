import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between } from 'typeorm';
import { ClassEntity } from '../classes/entities/class.entity';
import { EnrollmentEntity, EnrollmentStatus } from '../enrollment/entities/enrollment.entity';
import { LeadEntity } from '../leads/entities/lead.entity';
import { UserRoleEntity } from '../users/entities/user-role.entity';
import { ProfileEntity } from '../users/entities/profile.entity';
import { StudentAttendance } from '../students/entities/student-attendance.entity';
import { StudentProgress } from '../students/entities/student-progress.entity';
import { DailyReport, DailyReportStatus } from './entities/daily-report.entity';
import { Media } from '../media/entities/media.entity';
import { LeadInteraction } from '../leads/entities/lead-interaction.entity';
import { LeadWorkflowNotification } from '../leads/entities/lead-workflow-notification.entity';
import { MediaService } from '../media/media.service';
import { TeacherDashboardResponseDto, TeacherClassDto, TeacherStudentDto, TeacherLessonPlanDto } from './dto/teacher-dashboard.dto';
import { TeacherStudentsResponseDto, TeacherStudentResponseDto } from './dto/teacher-students.dto';
import { CreateDailyReportDto } from './dto/create-daily-report.dto';
import { DailyReportResponseDto } from './dto/daily-report-response.dto';
import { UploadTeacherMediaDto } from './dto/upload-teacher-media.dto';
import { TeacherMediaPostDto, MediaFileDto, TaggedStudentDto } from './dto/teacher-media-post.dto';
import { ParentProfileResponseDto } from './dto/parent-profile-response.dto';
import { TeacherInteractionNotificationDto } from './dto/teacher-interaction-notification.dto';
import { CreateLessonPlanDto } from './dto/create-lesson-plan.dto';
import { UpdateLessonPlanDto } from './dto/update-lesson-plan.dto';
import { LessonPlanResponseDto } from './dto/lesson-plan-response.dto';
import { CreateSkillProgressDto } from './dto/create-skill-progress.dto';
import { UpdateSkillProgressDto } from './dto/update-skill-progress.dto';
import { SkillProgressResponseDto } from './dto/skill-progress-response.dto';
import { CreateTeacherActivityDto } from './dto/create-teacher-activity.dto';
import { UpdateTeacherActivityDto } from './dto/update-teacher-activity.dto';
import { TeacherActivityResponseDto, ActivityFileDto, ActivityTaggedStudentDto } from './dto/teacher-activity-response.dto';
import { CreateScheduleEventDto } from './dto/create-schedule-event.dto';
import { UpdateScheduleEventDto } from './dto/update-schedule-event.dto';
import { ScheduleEventResponseDto } from './dto/schedule-event-response.dto';
import { LessonPlan, LessonPlanStatus } from './entities/lesson-plan.entity';
import { StudentSkillProgress } from './entities/student-skill-progress.entity';
import { TeacherActivity, ActivityStatus } from './entities/teacher-activity.entity';
import { TeacherScheduleEvent, TeacherScheduleEventType } from './entities/teacher-schedule-event.entity';
import { AppRole } from '../../common/enums/app-role.enum';

@Injectable()
export class TeachersService {
  private readonly logger = new Logger(TeachersService.name);

  constructor(
    @InjectRepository(ClassEntity)
    private readonly classRepository: Repository<ClassEntity>,
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentRepository: Repository<EnrollmentEntity>,
    @InjectRepository(LessonPlan)
    private readonly lessonPlanRepository: Repository<LessonPlan>,
    @InjectRepository(StudentSkillProgress)
    private readonly skillProgressRepository: Repository<StudentSkillProgress>,
    @InjectRepository(TeacherActivity)
    private readonly teacherActivityRepository: Repository<TeacherActivity>,
    @InjectRepository(TeacherScheduleEvent)
    private readonly scheduleEventRepository: Repository<TeacherScheduleEvent>,
    @InjectRepository(LeadEntity)
    private readonly leadRepository: Repository<LeadEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepository: Repository<UserRoleEntity>,
    @InjectRepository(ProfileEntity)
    private readonly profileRepository: Repository<ProfileEntity>,
    @InjectRepository(StudentAttendance)
    private readonly studentAttendanceRepository: Repository<StudentAttendance>,
    @InjectRepository(StudentProgress)
    private readonly studentProgressRepository: Repository<StudentProgress>,
    @InjectRepository(DailyReport)
    private readonly dailyReportRepository: Repository<DailyReport>,
    @InjectRepository(Media)
    private readonly mediaRepository: Repository<Media>,
    @InjectRepository(LeadInteraction)
    private readonly leadInteractionRepository: Repository<LeadInteraction>,
    @InjectRepository(LeadWorkflowNotification)
    private readonly workflowNotificationRepository: Repository<LeadWorkflowNotification>,
    private readonly mediaService: MediaService,
  ) {}

  /**
   * Get teacher dashboard data
   * Returns school_id, classes, students, and lesson plans
   */
  async getDashboardData(teacherId: string): Promise<TeacherDashboardResponseDto> {
    this.logger.log(`Fetching dashboard data for teacher: ${teacherId}`);

    // Get teacher's school_id from user_roles
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    const schoolId = userRole.schoolId;

    // Get teacher's assigned classes
    // The database uses teacher_id (singular), but the entity expects primary_teacher_id
    // Use raw SQL to query the actual database column
    const classesResult = await this.classRepository.query(
      `SELECT id, name FROM classes WHERE school_id = $1 AND teacher_id = $2`,
      [schoolId, teacherId],
    );
    
    const classes = classesResult.map((row: any) => ({
      id: row.id,
      name: row.name,
    }));

    const classIds = classes.map((c) => c.id);

    // If no classes, return empty data
    if (classIds.length === 0) {
      return {
        school_id: schoolId,
        classes: [],
        students: [],
        lesson_plans: [],
      };
    }

    // Get active enrollments for teacher's classes with lead information
    // Use raw SQL because the database column names don't match the entity property names
    const placeholders = classIds.map((_, index) => `$${index + 3}`).join(', ');
    const enrollmentsRaw = await this.enrollmentRepository.query(
      `SELECT 
        e.id,
        e.lead_id,
        e.status,
        e.program,
        e.class_id,
        e.school_id,
        l.id as lead_id_from_join,
        l.child_name,
        l.parent_name,
        l.parent_email as lead_parent_email,
        l.child_birthdate
      FROM enrollment e
      LEFT JOIN leads l ON l.id = e.lead_id
      WHERE e.school_id = $1 
        AND e.status = $2 
        AND e.class_id IN (${placeholders})
        AND e.class_id IS NOT NULL`,
      [schoolId, EnrollmentStatus.ACTIVE, ...classIds],
    );

    // Transform enrollments to match frontend format
    const students: TeacherStudentDto[] = enrollmentsRaw.map((row: any) => ({
      id: row.id,
      lead_id: row.lead_id || '',
      status: row.status,
      program: row.program || '',
      attendance_rate: null, // These are calculated fields, not stored in enrollment
      progress_percentage: null, // These are calculated fields, not stored in enrollment
      class_id: row.class_id || '',
      school_id: row.school_id || '',
      leads: {
        child_name: row.child_name || '',
        parent_name: row.parent_name || '',
        parent_email: row.lead_parent_email || '',
        child_birthdate: row.child_birthdate
          ? (row.child_birthdate instanceof Date
              ? row.child_birthdate.toISOString().split('T')[0]
              : typeof row.child_birthdate === 'string'
              ? row.child_birthdate.split('T')[0]
              : null)
          : null,
      },
    }));

    // Get recent lesson plans
    const lessonPlans = await this.lessonPlanRepository.find({
      where: { teacherId },
      order: { lessonDate: 'DESC' },
      take: 5,
      select: ['id', 'title', 'subject', 'lessonDate', 'status', 'objectives'],
    });

    // Transform lesson plans
    const transformedLessonPlans: TeacherLessonPlanDto[] = lessonPlans.map((lp) => ({
      id: lp.id,
      title: lp.title,
      subject: lp.subject,
      lesson_date: lp.lessonDate instanceof Date
        ? lp.lessonDate.toISOString().split('T')[0]
        : lp.lessonDate,
      status: lp.status,
      objectives: lp.objectives,
    }));

    // Transform classes
    const transformedClasses: TeacherClassDto[] = classes.map((c) => ({
      id: c.id,
      name: c.name,
    }));

    return {
      school_id: schoolId,
      classes: transformedClasses,
      students,
      lesson_plans: transformedLessonPlans,
    };
  }

  /**
   * Get students for teacher or admin/staff
   * Returns students with calculated attendance rates and progress percentages
   */
  async getStudents(userId: string): Promise<TeacherStudentsResponseDto> {
    this.logger.log(`Fetching students for user: ${userId}`);

    // Get user's role and school
    const userRole = await this.userRoleRepository.findOne({
      where: { userId },
      select: ['schoolId', 'role'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('User school not found or user role not assigned.');
    }

    const schoolId = userRole.schoolId;
    const role = userRole.role as AppRole;

    // Check if user is teacher, admissions_staff, or school_admin
    if (role !== AppRole.TEACHER && role !== AppRole.ADMISSIONS_STAFF && role !== AppRole.SCHOOL_ADMIN) {
      throw new ForbiddenException('Only teachers, admissions staff, and school admins can access students.');
    }

    let classIds: string[] = [];

    // If user is a teacher, get their assigned classes
    if (role === AppRole.TEACHER) {
      const classesResult = await this.classRepository.query(
        `SELECT id, name FROM classes WHERE school_id = $1 AND teacher_id = $2`,
        [schoolId, userId],
      );

      classIds = classesResult.map((c: any) => c.id);

      if (classIds.length === 0) {
        return {
          school_id: schoolId,
          students: [],
        };
      }
    }

    // Build the enrollment query with attendance and progress calculations
    // Use raw SQL to efficiently calculate attendance and progress in a single query
    let enrollmentQuery = `
      SELECT 
        e.id,
        e.lead_id,
        e.status,
        e.program,
        e.class_id,
        e.school_id,
        e.start_date,
        l.id as lead_id_from_join,
        l.child_name,
        l.parent_name,
        l.parent_email,
        l.parent_phone,
        l.child_birthdate,
        c.id as class_id_from_join,
        c.name as class_name,
        -- Calculate attendance rate
        COALESCE(
          CASE 
            WHEN attendance_stats.total_records = 0 THEN 0
            ELSE ROUND((attendance_stats.present_records::numeric / attendance_stats.total_records::numeric) * 100)
          END,
          0
        ) as attendance_rate,
        -- Calculate progress percentage from grades
        COALESCE(
          CASE 
            WHEN progress_stats.grade_count = 0 THEN 0
            ELSE ROUND(progress_stats.avg_grade_points)
          END,
          0
        ) as progress_percentage
      FROM enrollment e
      LEFT JOIN leads l ON l.id = e.lead_id
      LEFT JOIN classes c ON c.id = e.class_id
      -- Calculate attendance stats
      LEFT JOIN (
        SELECT 
          student_id,
          COUNT(*) as total_records,
          COUNT(*) FILTER (WHERE status IN ('present', 'late')) as present_records
        FROM student_attendance
        GROUP BY student_id
      ) attendance_stats ON attendance_stats.student_id = e.lead_id
      -- Calculate progress stats from grades
      LEFT JOIN (
        SELECT 
          student_id,
          COUNT(*) as grade_count,
          AVG(
            CASE 
              WHEN UPPER(grade) IN ('A', 'A+') THEN 95
              WHEN UPPER(grade) = 'A-' THEN 90
              WHEN UPPER(grade) = 'B+' THEN 87
              WHEN UPPER(grade) = 'B' THEN 83
              WHEN UPPER(grade) = 'B-' THEN 80
              WHEN UPPER(grade) = 'C+' THEN 77
              WHEN UPPER(grade) = 'C' THEN 73
              WHEN UPPER(grade) = 'C-' THEN 70
              WHEN UPPER(grade) = 'D+' THEN 67
              WHEN UPPER(grade) = 'D' THEN 63
              WHEN UPPER(grade) = 'D-' THEN 60
              ELSE 50
            END
          ) as avg_grade_points
        FROM student_progress
        WHERE grade IS NOT NULL
        GROUP BY student_id
      ) progress_stats ON progress_stats.student_id = e.lead_id
      WHERE e.school_id = $1 
        AND e.status = $2
    `;

    const queryParams: any[] = [schoolId, EnrollmentStatus.ACTIVE];

    // If teacher, filter by class IDs
    if (role === AppRole.TEACHER && classIds.length > 0) {
      const placeholders = classIds.map((_, index) => `$${index + 3}`).join(', ');
      enrollmentQuery += ` AND e.class_id IN (${placeholders})`;
      queryParams.push(...classIds);
    }

    enrollmentQuery += ` ORDER BY l.child_name ASC`;

    const enrollmentsRaw = await this.enrollmentRepository.query(enrollmentQuery, queryParams);

    // Transform to response DTO
    const students: TeacherStudentResponseDto[] = enrollmentsRaw.map((row: any) => ({
      id: row.id,
      lead_id: row.lead_id || '',
      status: row.status,
      program: row.program || '',
      start_date: row.start_date
        ? (row.start_date instanceof Date
            ? row.start_date.toISOString().split('T')[0]
            : typeof row.start_date === 'string'
            ? row.start_date.split('T')[0]
            : null)
        : null,
      attendance_rate: parseInt(row.attendance_rate) || 0,
      progress_percentage: parseInt(row.progress_percentage) || 0,
      class_id: row.class_id || null,
      school_id: row.school_id || '',
      leads: {
        child_name: row.child_name || '',
        parent_name: row.parent_name || '',
        parent_email: row.parent_email || '',
        parent_phone: row.parent_phone || null,
        child_birthdate: row.child_birthdate
          ? (row.child_birthdate instanceof Date
              ? row.child_birthdate.toISOString().split('T')[0]
              : typeof row.child_birthdate === 'string'
              ? row.child_birthdate.split('T')[0]
              : null)
          : null,
      },
      classes: row.class_id_from_join
        ? {
            id: row.class_id_from_join,
            name: row.class_name || '',
          }
        : null,
    }));

    return {
      school_id: schoolId,
      students,
    };
  }

  /**
   * Get all daily reports for a teacher
   */
  async getDailyReports(teacherId: string): Promise<DailyReportResponseDto[]> {
    this.logger.log(`Fetching daily reports for teacher: ${teacherId}`);

    // Verify teacher has access to school
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    const reports = await this.dailyReportRepository.find({
      where: { teacherId },
      order: { reportDate: 'DESC' },
    });

    return reports.map((report) => ({
      id: report.id,
      teacherId: report.teacherId,
      schoolId: report.schoolId,
      studentId: report.studentId,
      reportDate: report.reportDate instanceof Date
        ? report.reportDate.toISOString().split('T')[0]
        : report.reportDate,
      studentNames: report.studentNames || [],
      activities: report.activities,
      meals: report.meals,
      napTime: report.napTime,
      moodBehavior: report.moodBehavior,
      milestones: report.milestones,
      notes: report.notes,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    }));
  }

  /**
   * Create a new daily report
   */
  async createDailyReport(
    teacherId: string,
    dto: CreateDailyReportDto,
  ): Promise<DailyReportResponseDto> {
    this.logger.log(`Creating daily report for teacher: ${teacherId}`);

    // Get teacher's school_id
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    const report = this.dailyReportRepository.create({
      teacherId,
      schoolId: userRole.schoolId,
      reportDate: new Date(dto.reportDate),
      studentNames: dto.studentNames,
      activities: dto.activities || null,
      meals: dto.meals || null,
      napTime: dto.napTime || null,
      moodBehavior: dto.moodBehavior || null,
      milestones: dto.milestones || null,
      notes: dto.notes || null,
      status: DailyReportStatus.DRAFT,
    });

    const savedReport = await this.dailyReportRepository.save(report);

    return {
      id: savedReport.id,
      teacherId: savedReport.teacherId,
      schoolId: savedReport.schoolId,
      studentId: savedReport.studentId,
      reportDate: savedReport.reportDate instanceof Date
        ? savedReport.reportDate.toISOString().split('T')[0]
        : savedReport.reportDate,
      studentNames: savedReport.studentNames || [],
      activities: savedReport.activities,
      meals: savedReport.meals,
      napTime: savedReport.napTime,
      moodBehavior: savedReport.moodBehavior,
      milestones: savedReport.milestones,
      notes: savedReport.notes,
      status: savedReport.status,
      createdAt: savedReport.createdAt.toISOString(),
      updatedAt: savedReport.updatedAt.toISOString(),
    };
  }

  /**
   * Update daily report status
   */
  async updateDailyReportStatus(
    reportId: string,
    status: DailyReportStatus,
    teacherId: string,
  ): Promise<DailyReportResponseDto> {
    this.logger.log(`Updating daily report ${reportId} status to ${status} for teacher: ${teacherId}`);

    const report = await this.dailyReportRepository.findOne({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Daily report not found');
    }

    // Verify teacher owns the report
    if (report.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update your own reports');
    }

    report.status = status;
    const updatedReport = await this.dailyReportRepository.save(report);

    return {
      id: updatedReport.id,
      teacherId: updatedReport.teacherId,
      schoolId: updatedReport.schoolId,
      studentId: updatedReport.studentId,
      reportDate: updatedReport.reportDate instanceof Date
        ? updatedReport.reportDate.toISOString().split('T')[0]
        : updatedReport.reportDate,
      studentNames: updatedReport.studentNames || [],
      activities: updatedReport.activities,
      meals: updatedReport.meals,
      napTime: updatedReport.napTime,
      moodBehavior: updatedReport.moodBehavior,
      milestones: updatedReport.milestones,
      notes: updatedReport.notes,
      status: updatedReport.status,
      createdAt: updatedReport.createdAt.toISOString(),
      updatedAt: updatedReport.updatedAt.toISOString(),
    };
  }

  /**
   * Get all media posts for a teacher
   * Groups media by caption/description to create posts
   */
  async getMediaPosts(teacherId: string): Promise<TeacherMediaPostDto[]> {
    this.logger.log(`Fetching media posts for teacher: ${teacherId}`);

    // Get teacher's school_id
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    // Fetch all media uploaded by teacher with lead information
    const mediaRecords = await this.mediaRepository
      .createQueryBuilder('media')
      .leftJoinAndSelect('media.child', 'lead')
      .where('media.uploadedBy = :teacherId', { teacherId })
      .orderBy('media.createdAt', 'DESC')
      .getMany();

    // Group media by description (caption) to create posts
    const postsMap = new Map<string, TeacherMediaPostDto>();

    for (const media of mediaRecords) {
      const key = media.description || 'Untitled';
      
      if (!postsMap.has(key)) {
        postsMap.set(key, {
          id: key,
          files: [],
          caption: media.description || '',
          taggedStudents: [],
          dateCreated: media.createdAt.toISOString(),
          isPrivate: false, // TODO: Add privacy field to media entity if needed
        });
      }

      const post = postsMap.get(key)!;
      
      // Add media file
      const mediaFile: MediaFileDto = {
        id: media.id,
        childId: media.childId,
        fileName: media.fileName,
        fileUrl: media.fileUrl,
        fileType: media.fileType,
        description: media.description,
        tags: media.tags,
        createdAt: media.createdAt.toISOString(),
        student: {
          id: media.child?.id || media.childId,
          childName: media.child?.childName || '',
          parentName: media.child?.parentName || '',
          parentEmail: media.child?.parentEmail || '',
        },
      };

      post.files.push(mediaFile);

      // Add unique students to taggedStudents
      if (media.child) {
        const studentExists = post.taggedStudents.some(
          s => s.id === media.child!.id
        );
        if (!studentExists) {
          post.taggedStudents.push({
            id: media.child.id,
            childName: media.child.childName || '',
            parentName: media.child.parentName || '',
            parentEmail: media.child.parentEmail || '',
          });
        }
      }
    }

    const postsArray = Array.from(postsMap.values());

    // Fetch likes and comments for these posts
    if (postsArray.length > 0) {
      const mediaIds = postsArray.flatMap(post => post.files.map(file => file.id));

      // Fetch all likes using raw SQL to avoid updated_at column issue
      const likesPlaceholders = mediaIds.map((_, i) => `$${i + 2}`).join(', ');
      const likesQuery = `
        SELECT id, lead_id, user_id, interaction_type, subject, content, interaction_date, created_at
        FROM lead_interactions
        WHERE interaction_type = $1
          AND content IN (${likesPlaceholders})
      `;
      const likesResult = await this.leadInteractionRepository.query(
        likesQuery,
        ['like', ...mediaIds.map(id => `Liked media: ${id}`)]
      );

      // Fetch all comments using raw SQL
      const commentsPlaceholders = mediaIds.map((_, i) => `$${i + 2}`).join(', ');
      const commentsQuery = `
        SELECT id, lead_id, user_id, interaction_type, subject, content, interaction_date, created_at
        FROM lead_interactions
        WHERE interaction_type = $1
          AND subject IN (${commentsPlaceholders})
      `;
      const commentsResult = await this.leadInteractionRepository.query(
        commentsQuery,
        ['comment', ...mediaIds.map(id => `Media Comment: ${id}`)]
      );

      // Update posts with interaction counts
      postsArray.forEach(post => {
        const postMediaIds = post.files.map(file => file.id);

        // Count likes for all media in this post
        const postLikes = likesResult.filter((like: any) =>
          postMediaIds.some(mediaId => like.content === `Liked media: ${mediaId}`)
        ).length;

        // Get comments for all media in this post
        const postComments = commentsResult.filter((comment: any) =>
          postMediaIds.some(mediaId => comment.subject === `Media Comment: ${mediaId}`)
        );

        post.likes = postLikes;
        post.comments = postComments;
      });
    }

    return postsArray;
  }

  /**
   * Upload multiple media files and create notifications
   */
  async uploadTeacherMedia(
    files: Express.Multer.File[],
    dto: UploadTeacherMediaDto,
    teacherId: string,
  ): Promise<TeacherMediaPostDto> {
    this.logger.log(`Uploading ${files.length} media files for teacher: ${teacherId}`);

    // Get teacher's school_id
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    // Validate all students exist
    const students = await this.leadRepository.find({
      where: { id: In(dto.studentIds) },
    });

    if (students.length !== dto.studentIds.length) {
      throw new NotFoundException('One or more students not found');
    }

    // Get school_id from enrollment for first student (all should be same school)
    // Use raw query since the entity property name might differ
    const enrollmentResult = await this.enrollmentRepository.query(
      `SELECT school_id FROM enrollment WHERE lead_id = $1 LIMIT 1`,
      [dto.studentIds[0]]
    );
    const enrollment = enrollmentResult?.[0];

    const schoolId = enrollment?.schoolId || userRole.schoolId;

    // Upload each file and create media records
    const uploadedMedia: Media[] = [];

    for (const file of files) {
      for (const studentId of dto.studentIds) {
        // Use media service to upload file
        const mediaResponse = await this.mediaService.uploadMedia(
          file,
          {
            schoolId,
            childId: studentId,
            description: dto.caption || undefined,
            tags: dto.studentIds,
            isFeatured: false,
          },
          teacherId,
        );

        // Get the created media record
        const media = await this.mediaRepository.findOne({
          where: { id: mediaResponse.id },
          relations: ['child'],
        });

        if (media) {
          uploadedMedia.push(media);
        }
      }
    }

    // Create parent notifications using raw SQL to avoid updated_at column issue
    for (const student of students) {
      await this.workflowNotificationRepository.query(
        `INSERT INTO lead_workflow_notifications (
          id, created_at, lead_id, school_id, recipient_email, recipient_type, 
          notification_type, status, subject, content, sent_at, metadata
        ) VALUES (
          gen_random_uuid(), now(), $1, $2, $3, $4, $5, $6, $7, $8, NULL, '{}'::jsonb
        )`,
        [
          student.id,
          schoolId,
          student.parentEmail,
          'parent',
          'media_upload',
          'pending',
          `New Media: ${student.childName}`,
          `New photo/video of ${student.childName} has been shared by their teacher.${dto.caption ? ` Caption: "${dto.caption}"` : ''}`,
        ]
      );
    }

    // Return the created post
    const post: TeacherMediaPostDto = {
      id: dto.caption || 'Untitled',
      files: uploadedMedia.map(media => ({
        id: media.id,
        childId: media.childId,
        fileName: media.fileName,
        fileUrl: media.fileUrl,
        fileType: media.fileType,
        description: media.description,
        tags: media.tags,
        createdAt: media.createdAt.toISOString(),
        student: {
          id: media.child?.id || media.childId,
          childName: media.child?.childName || '',
          parentName: media.child?.parentName || '',
          parentEmail: media.child?.parentEmail || '',
        },
      })),
      caption: dto.caption || '',
      taggedStudents: students.map(s => ({
        id: s.id,
        childName: s.childName || '',
        parentName: s.parentName || '',
        parentEmail: s.parentEmail || '',
      })),
      dateCreated: new Date().toISOString(),
      isPrivate: dto.isPrivate || false,
      likes: 0,
      comments: [],
    };

    return post;
  }

  /**
   * Get parent profile by email (for teacher access)
   * Validates that the teacher has access to students with this parent email
   */
  async getParentProfileByEmail(
    teacherId: string,
    parentEmail: string,
  ): Promise<ParentProfileResponseDto | null> {
    this.logger.log(`Looking up parent profile for email: ${parentEmail} by teacher: ${teacherId}`);

    // Check if the teacher has access to students with this parent email
    const hasAccess = await this.enrollmentRepository.query(
      `SELECT 1 
       FROM enrollment e
       JOIN classes c ON c.id = e.class_id
       JOIN leads l ON l.id = e.lead_id
       WHERE c.teacher_id = $1
         AND l.parent_email = $2
         AND e.status = $3
       LIMIT 1`,
      [teacherId, parentEmail, EnrollmentStatus.ACTIVE],
    );

    if (!hasAccess || hasAccess.length === 0) {
      this.logger.warn(`Teacher ${teacherId} does not have access to students with parent email: ${parentEmail}`);
      return null;
    }

    // Get parent profile by email
    const profile = await this.profileRepository.findOne({
      where: { email: parentEmail },
      select: ['id', 'firstName', 'lastName', 'email'],
    });

    if (!profile) {
      this.logger.warn(`Parent profile not found for email: ${parentEmail}`);
      return null;
    }

    // Verify the profile has a parent role
    const parentRole = await this.userRoleRepository.findOne({
      where: { userId: profile.id, role: AppRole.PARENT },
    });

    if (!parentRole) {
      this.logger.warn(`Profile ${profile.id} is not a parent`);
      return null;
    }

    return {
      parentId: profile.id,
      parentFirstName: profile.firstName || '',
      parentLastName: profile.lastName || '',
      parentEmail: profile.email,
    };
  }

  /**
   * Get teacher interaction notifications
   * Fetches interactions where the teacher is the recipient (user_id = teacherId)
   */
  async getTeacherInteractions(teacherId: string): Promise<TeacherInteractionNotificationDto[]> {
    this.logger.log(`Fetching interaction notifications for teacher: ${teacherId}`);

    // Use raw SQL to avoid updated_at column issue and to join with leads
    const interactions = await this.leadInteractionRepository.query(
      `SELECT 
        li.id,
        li.lead_id,
        li.user_id,
        li.interaction_type,
        li.subject,
        li.content,
        li.created_at,
        li.interaction_date,
        l.child_name,
        l.parent_name
      FROM lead_interactions li
      INNER JOIN leads l ON l.id = li.lead_id
      WHERE li.user_id = $1
        AND li.interaction_type = $2
      ORDER BY li.created_at DESC
      LIMIT 50`,
      [teacherId, 'notification'],
    );

    return interactions.map((interaction: any) => ({
      id: interaction.id,
      leadId: interaction.lead_id,
      userId: interaction.user_id,
      interactionType: interaction.interaction_type,
      subject: interaction.subject,
      content: interaction.content,
      createdAt: interaction.created_at || interaction.interaction_date,
      childName: interaction.child_name || null,
      parentName: interaction.parent_name || null,
      isRead: false, // lead_interactions doesn't have read status, can be enhanced later
    }));
  }

  /**
   * Get count of unread teacher interaction notifications
   * Returns count of notifications from the last 24 hours
   */
  async getTeacherInteractionCount(teacherId: string, hours: number = 24): Promise<number> {
    this.logger.log(`Fetching interaction notification count for teacher: ${teacherId} (last ${hours} hours)`);

    const hoursAgo = new Date();
    hoursAgo.setHours(hoursAgo.getHours() - hours);

    // Use raw SQL to count interactions
    const result = await this.leadInteractionRepository.query(
      `SELECT COUNT(*) as count
      FROM lead_interactions
      WHERE user_id = $1
        AND interaction_type = $2
        AND created_at >= $3`,
      [teacherId, 'notification', hoursAgo.toISOString()],
    );

    return parseInt(result[0]?.count || '0', 10);
  }

  /**
   * Get all lesson plans for a teacher
   */
  async getLessonPlans(teacherId: string): Promise<LessonPlanResponseDto[]> {
    this.logger.log(`Fetching lesson plans for teacher: ${teacherId}`);

    // Get teacher's school_id
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    const lessonPlans = await this.lessonPlanRepository.find({
      where: { teacherId },
      order: { lessonDate: 'DESC', createdAt: 'DESC' },
    });

    return lessonPlans.map((plan) => ({
      id: plan.id,
      title: plan.title,
      subject: plan.subject,
      lessonDate: plan.lessonDate instanceof Date
        ? plan.lessonDate.toISOString().split('T')[0]
        : plan.lessonDate,
      objectives: plan.objectives,
      materials: plan.materials || [],
      activities: plan.activities,
      assessment: plan.assessment,
      notes: plan.notes,
      status: plan.status,
      duration: plan.duration || 60,
      ageGroup: plan.ageGroup,
      classId: plan.classId,
      schoolId: plan.schoolId,
      teacherId: plan.teacherId,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    }));
  }

  /**
   * Create a new lesson plan
   */
  async createLessonPlan(
    teacherId: string,
    dto: CreateLessonPlanDto,
  ): Promise<LessonPlanResponseDto> {
    this.logger.log(`Creating lesson plan for teacher: ${teacherId}`);

    // Get teacher's school_id
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    // Get class_id - use provided classId or get teacher's first class
    let classId = dto.classId;
    if (!classId) {
      const classesResult = await this.classRepository.query(
        `SELECT id FROM classes WHERE school_id = $1 AND teacher_id = $2 LIMIT 1`,
        [userRole.schoolId, teacherId],
      );
      if (classesResult.length === 0) {
        throw new NotFoundException('No classes found for teacher. Please assign a class first.');
      }
      classId = classesResult[0].id;
    }

    // Verify class belongs to teacher's school
    const classEntity = await this.classRepository.findOne({
      where: { id: classId },
      select: ['id', 'schoolId'],
    });

    if (!classEntity || classEntity.schoolId !== userRole.schoolId) {
      throw new ForbiddenException('Class does not belong to your school');
    }

    const lessonPlan = this.lessonPlanRepository.create({
      teacherId,
      classId,
      schoolId: userRole.schoolId,
      title: dto.title,
      subject: dto.subject,
      lessonDate: new Date(dto.lessonDate),
      objectives: dto.objectives,
      materials: dto.materials || [],
      activities: dto.activities || null,
      assessment: dto.assessment || null,
      notes: dto.notes || null,
      duration: dto.duration || 60,
      ageGroup: dto.ageGroup || null,
      status: LessonPlanStatus.PLANNED,
    });

    const savedPlan = await this.lessonPlanRepository.save(lessonPlan);

    return {
      id: savedPlan.id,
      title: savedPlan.title,
      subject: savedPlan.subject,
      lessonDate: savedPlan.lessonDate instanceof Date
        ? savedPlan.lessonDate.toISOString().split('T')[0]
        : savedPlan.lessonDate,
      objectives: savedPlan.objectives,
      materials: savedPlan.materials || [],
      activities: savedPlan.activities,
      assessment: savedPlan.assessment,
      notes: savedPlan.notes,
      status: savedPlan.status,
      duration: savedPlan.duration || 60,
      ageGroup: savedPlan.ageGroup,
      classId: savedPlan.classId,
      schoolId: savedPlan.schoolId,
      teacherId: savedPlan.teacherId,
      createdAt: savedPlan.createdAt.toISOString(),
      updatedAt: savedPlan.updatedAt.toISOString(),
    };
  }

  /**
   * Update a lesson plan
   */
  async updateLessonPlan(
    lessonPlanId: string,
    teacherId: string,
    dto: UpdateLessonPlanDto,
  ): Promise<LessonPlanResponseDto> {
    this.logger.log(`Updating lesson plan ${lessonPlanId} for teacher: ${teacherId}`);

    const lessonPlan = await this.lessonPlanRepository.findOne({
      where: { id: lessonPlanId },
    });

    if (!lessonPlan) {
      throw new NotFoundException('Lesson plan not found');
    }

    // Verify teacher owns the lesson plan
    if (lessonPlan.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update your own lesson plans');
    }

    // Update fields
    if (dto.title !== undefined) lessonPlan.title = dto.title;
    if (dto.subject !== undefined) lessonPlan.subject = dto.subject;
    if (dto.lessonDate !== undefined) lessonPlan.lessonDate = new Date(dto.lessonDate);
    if (dto.objectives !== undefined) lessonPlan.objectives = dto.objectives;
    if (dto.materials !== undefined) lessonPlan.materials = dto.materials;
    if (dto.activities !== undefined) lessonPlan.activities = dto.activities;
    if (dto.assessment !== undefined) lessonPlan.assessment = dto.assessment;
    if (dto.notes !== undefined) lessonPlan.notes = dto.notes;
    if (dto.duration !== undefined) lessonPlan.duration = dto.duration;
    if (dto.ageGroup !== undefined) lessonPlan.ageGroup = dto.ageGroup;
    if (dto.status !== undefined) lessonPlan.status = dto.status;

    const updatedPlan = await this.lessonPlanRepository.save(lessonPlan);

    return {
      id: updatedPlan.id,
      title: updatedPlan.title,
      subject: updatedPlan.subject,
      lessonDate: updatedPlan.lessonDate instanceof Date
        ? updatedPlan.lessonDate.toISOString().split('T')[0]
        : updatedPlan.lessonDate,
      objectives: updatedPlan.objectives,
      materials: updatedPlan.materials || [],
      activities: updatedPlan.activities,
      assessment: updatedPlan.assessment,
      notes: updatedPlan.notes,
      status: updatedPlan.status,
      duration: updatedPlan.duration || 60,
      ageGroup: updatedPlan.ageGroup,
      classId: updatedPlan.classId,
      schoolId: updatedPlan.schoolId,
      teacherId: updatedPlan.teacherId,
      createdAt: updatedPlan.createdAt.toISOString(),
      updatedAt: updatedPlan.updatedAt.toISOString(),
    };
  }

  /**
   * Update lesson plan status
   */
  async updateLessonPlanStatus(
    lessonPlanId: string,
    status: LessonPlanStatus,
    teacherId: string,
  ): Promise<LessonPlanResponseDto> {
    this.logger.log(`Updating lesson plan ${lessonPlanId} status to ${status} for teacher: ${teacherId}`);

    const lessonPlan = await this.lessonPlanRepository.findOne({
      where: { id: lessonPlanId },
    });

    if (!lessonPlan) {
      throw new NotFoundException('Lesson plan not found');
    }

    // Verify teacher owns the lesson plan
    if (lessonPlan.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update your own lesson plans');
    }

    lessonPlan.status = status;
    const updatedPlan = await this.lessonPlanRepository.save(lessonPlan);

    return {
      id: updatedPlan.id,
      title: updatedPlan.title,
      subject: updatedPlan.subject,
      lessonDate: updatedPlan.lessonDate instanceof Date
        ? updatedPlan.lessonDate.toISOString().split('T')[0]
        : updatedPlan.lessonDate,
      objectives: updatedPlan.objectives,
      materials: updatedPlan.materials || [],
      activities: updatedPlan.activities,
      assessment: updatedPlan.assessment,
      notes: updatedPlan.notes,
      status: updatedPlan.status,
      duration: updatedPlan.duration || 60,
      ageGroup: updatedPlan.ageGroup,
      classId: updatedPlan.classId,
      schoolId: updatedPlan.schoolId,
      teacherId: updatedPlan.teacherId,
      createdAt: updatedPlan.createdAt.toISOString(),
      updatedAt: updatedPlan.updatedAt.toISOString(),
    };
  }

  /**
   * Delete a lesson plan
   */
  async deleteLessonPlan(lessonPlanId: string, teacherId: string): Promise<void> {
    this.logger.log(`Deleting lesson plan ${lessonPlanId} for teacher: ${teacherId}`);

    const lessonPlan = await this.lessonPlanRepository.findOne({
      where: { id: lessonPlanId },
    });

    if (!lessonPlan) {
      throw new NotFoundException('Lesson plan not found');
    }

    // Verify teacher owns the lesson plan
    if (lessonPlan.teacherId !== teacherId) {
      throw new ForbiddenException('You can only delete your own lesson plans');
    }

    await this.lessonPlanRepository.remove(lessonPlan);
  }

  /**
   * Get all skill progress records for a teacher
   */
  async getSkillProgress(teacherId: string): Promise<SkillProgressResponseDto[]> {
    this.logger.log(`Fetching skill progress records for teacher: ${teacherId}`);

    // Use raw SQL to get records (student_id in DB is actually lead_id)
    const records = await this.skillProgressRepository.query(
      `SELECT 
        id, student_id as lead_id, teacher_id, skill_area, skill_name,
        current_level, target_level, observation, milestone_achieved,
        recorded_date, next_steps, created_at, updated_at
      FROM student_skill_progress
      WHERE teacher_id = $1
      ORDER BY recorded_date DESC, created_at DESC`,
      [teacherId],
    );

    if (records.length === 0) {
      return [];
    }

    // Get enrollment IDs and student names by matching lead_ids
    const leadIds = [...new Set(records.map((r: any) => r.lead_id))];
    const placeholders = leadIds.map((_, i) => `$${i + 1}`).join(', ');
    const enrollmentsRaw = await this.enrollmentRepository.query(
      `SELECT 
        e.id as enrollment_id,
        e.lead_id,
        l.child_name
      FROM enrollment e
      LEFT JOIN leads l ON l.id = e.lead_id
      WHERE e.lead_id IN (${placeholders}) AND e.status = 'active'
      ORDER BY e.created_at DESC`,
      leadIds,
    );

    // Create maps: lead_id -> enrollment_id, lead_id -> child_name
    const enrollmentMap = new Map<string, string>();
    const studentNameMap = new Map<string, string>();
    
    enrollmentsRaw.forEach((row: any) => {
      if (row.lead_id) {
        enrollmentMap.set(row.lead_id, row.enrollment_id);
        studentNameMap.set(row.lead_id, row.child_name || 'Unknown Student');
      }
    });

    return records.map((record: any) => ({
      id: record.id,
      studentId: enrollmentMap.get(record.lead_id) || record.lead_id, // Return enrollment_id for frontend
      studentName: studentNameMap.get(record.lead_id) || 'Unknown Student',
      teacherId: record.teacher_id,
      skillArea: record.skill_area,
      skillName: record.skill_name,
      currentLevel: record.current_level,
      targetLevel: record.target_level,
      observation: record.observation,
      milestoneAchieved: record.milestone_achieved,
      recordedDate: record.recorded_date instanceof Date
        ? record.recorded_date.toISOString().split('T')[0]
        : record.recorded_date,
      nextSteps: record.next_steps,
      createdAt: record.created_at instanceof Date
        ? record.created_at.toISOString()
        : record.created_at,
      updatedAt: record.updated_at instanceof Date
        ? record.updated_at.toISOString()
        : record.updated_at,
    }));
  }

  /**
   * Create a new skill progress record
   */
  async createSkillProgress(
    teacherId: string,
    dto: CreateSkillProgressDto,
  ): Promise<SkillProgressResponseDto> {
    this.logger.log(`Creating skill progress record for teacher: ${teacherId}`);

    // Verify enrollment exists and teacher has access using raw SQL
    // Get lead_id from enrollment (student_id in the table references leads.id, not enrollment.id)
    const enrollmentCheck = await this.enrollmentRepository.query(
      `SELECT 
        e.id as enrollment_id,
        e.lead_id,
        l.child_name
       FROM enrollment e
       LEFT JOIN leads l ON l.id = e.lead_id
       JOIN classes c ON c.id = e.class_id
       WHERE e.id = $1 AND c.teacher_id = $2
       LIMIT 1`,
      [dto.studentId, teacherId],
    );

    if (!enrollmentCheck || enrollmentCheck.length === 0) {
      throw new NotFoundException('Student enrollment not found or you do not have access');
    }

    const enrollmentData = enrollmentCheck[0];
    const leadId = enrollmentData.lead_id;
    const studentName = enrollmentData.child_name || 'Unknown Student';

    if (!leadId) {
      throw new NotFoundException('Lead ID not found for this enrollment');
    }

    // Use raw SQL to insert (bypasses foreign key constraint since student_id references leads.id)
    const recordedDate = dto.recordedDate ? new Date(dto.recordedDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    
    const result = await this.skillProgressRepository.query(
      `INSERT INTO student_skill_progress (
        student_id, teacher_id, skill_area, skill_name, current_level, 
        target_level, observation, milestone_achieved, recorded_date, next_steps,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING id, student_id, teacher_id, skill_area, skill_name, current_level,
        target_level, observation, milestone_achieved, recorded_date, next_steps,
        created_at, updated_at`,
      [
        leadId, // Use lead_id, not enrollment_id
        teacherId,
        dto.skillArea,
        dto.skillName,
        dto.currentLevel,
        dto.targetLevel,
        dto.observation,
        dto.milestoneAchieved ?? false,
        recordedDate,
        dto.nextSteps || null,
      ],
    );

    const saved = result[0];

    return {
      id: saved.id,
      studentId: dto.studentId, // Return enrollment ID for frontend compatibility
      studentName,
      teacherId: saved.teacher_id,
      skillArea: saved.skill_area,
      skillName: saved.skill_name,
      currentLevel: saved.current_level,
      targetLevel: saved.target_level,
      observation: saved.observation,
      milestoneAchieved: saved.milestone_achieved,
      recordedDate: saved.recorded_date instanceof Date
        ? saved.recorded_date.toISOString().split('T')[0]
        : saved.recorded_date,
      nextSteps: saved.next_steps,
      createdAt: saved.created_at instanceof Date
        ? saved.created_at.toISOString()
        : saved.created_at,
      updatedAt: saved.updated_at instanceof Date
        ? saved.updated_at.toISOString()
        : saved.updated_at,
    };
  }

  /**
   * Update a skill progress record
   */
  async updateSkillProgress(
    recordId: string,
    teacherId: string,
    dto: UpdateSkillProgressDto,
  ): Promise<SkillProgressResponseDto> {
    this.logger.log(`Updating skill progress record ${recordId} for teacher: ${teacherId}`);

    // Get existing record using raw SQL
    const existingRecord = await this.skillProgressRepository.query(
      `SELECT id, student_id as lead_id, teacher_id
       FROM student_skill_progress
       WHERE id = $1
       LIMIT 1`,
      [recordId],
    );

    if (!existingRecord || existingRecord.length === 0) {
      throw new NotFoundException('Skill progress record not found');
    }

    // Verify teacher owns the record
    if (existingRecord[0].teacher_id !== teacherId) {
      throw new ForbiddenException('You can only update your own progress records');
    }

    const leadId = existingRecord[0].lead_id;

    // Build update query dynamically
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    this.logger.debug(`Updating skill progress with DTO:`, JSON.stringify(dto));

    if (dto.skillArea !== undefined && dto.skillArea !== null) {
      updateFields.push(`skill_area = $${paramIndex++}`);
      updateValues.push(dto.skillArea);
    }
    if (dto.skillName !== undefined && dto.skillName !== null) {
      updateFields.push(`skill_name = $${paramIndex++}`);
      updateValues.push(dto.skillName);
    }
    if (dto.currentLevel !== undefined && dto.currentLevel !== null) {
      updateFields.push(`current_level = $${paramIndex++}`);
      updateValues.push(dto.currentLevel);
    }
    if (dto.targetLevel !== undefined && dto.targetLevel !== null) {
      updateFields.push(`target_level = $${paramIndex++}`);
      updateValues.push(dto.targetLevel);
    }
    if (dto.observation !== undefined && dto.observation !== null) {
      updateFields.push(`observation = $${paramIndex++}`);
      updateValues.push(dto.observation);
    }
    if (dto.milestoneAchieved !== undefined && dto.milestoneAchieved !== null) {
      updateFields.push(`milestone_achieved = $${paramIndex++}`);
      updateValues.push(dto.milestoneAchieved);
    }
    if (dto.recordedDate !== undefined && dto.recordedDate !== null) {
      updateFields.push(`recorded_date = $${paramIndex++}`);
      updateValues.push(new Date(dto.recordedDate).toISOString().split('T')[0]);
    }
    if (dto.nextSteps !== undefined && dto.nextSteps !== null) {
      updateFields.push(`next_steps = $${paramIndex++}`);
      updateValues.push(dto.nextSteps);
    }

    this.logger.debug(`Update fields: ${updateFields.join(', ')}`);
    this.logger.debug(`Update values:`, updateValues);

    if (updateFields.length === 0) {
      // No fields to update, just return the existing record
      const record = await this.skillProgressRepository.query(
        `SELECT * FROM student_skill_progress WHERE id = $1 LIMIT 1`,
        [recordId],
      );
      const result = record[0];
      
      // Get enrollment ID and student name - ensure it belongs to teacher's class
      const enrollmentRaw = await this.enrollmentRepository.query(
        `SELECT e.id as enrollment_id, l.child_name
         FROM enrollment e
         LEFT JOIN leads l ON l.id = e.lead_id
         JOIN classes c ON c.id = e.class_id
         WHERE e.lead_id = $1 AND e.status = 'active' AND c.teacher_id = $2
         ORDER BY e.created_at DESC
         LIMIT 1`,
        [leadId, teacherId],
      );

      const enrollmentId = enrollmentRaw?.[0]?.enrollment_id || leadId;
      const studentName = enrollmentRaw?.[0]?.child_name || 'Unknown Student';

      return {
        id: result.id,
        studentId: enrollmentId,
        studentName,
        teacherId: result.teacher_id,
        skillArea: result.skill_area,
        skillName: result.skill_name,
        currentLevel: result.current_level,
        targetLevel: result.target_level,
        observation: result.observation,
        milestoneAchieved: result.milestone_achieved,
        recordedDate: result.recorded_date instanceof Date
          ? result.recorded_date.toISOString().split('T')[0]
          : result.recorded_date,
        nextSteps: result.next_steps,
        createdAt: result.created_at instanceof Date
          ? result.created_at.toISOString()
          : result.created_at,
        updatedAt: result.updated_at instanceof Date
          ? result.updated_at.toISOString()
          : result.updated_at,
      };
    }

    // Add updated_at
    updateFields.push(`updated_at = NOW()`);
    updateValues.push(recordId);

    const updateQuery = `
      UPDATE student_skill_progress
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, student_id as lead_id, teacher_id, skill_area, skill_name,
        current_level, target_level, observation, milestone_achieved,
        recorded_date, next_steps, created_at, updated_at
    `;

    this.logger.debug(`Update query: ${updateQuery}`);
    this.logger.debug(`Query params:`, updateValues);

    const result = await this.skillProgressRepository.query(updateQuery, updateValues);
    
    if (!result || result.length === 0 || !result[0]) {
      throw new NotFoundException('Failed to update skill progress record');
    }

    // Fetch the updated record again to ensure we have the latest values
    // Sometimes RETURNING clause might not return updated values correctly
    const freshRecord = await this.skillProgressRepository.query(
      `SELECT id, student_id as lead_id, teacher_id, skill_area, skill_name,
       current_level, target_level, observation, milestone_achieved,
       recorded_date, next_steps, created_at, updated_at
       FROM student_skill_progress
       WHERE id = $1 LIMIT 1`,
      [recordId],
    );

    if (!freshRecord || freshRecord.length === 0) {
      throw new NotFoundException('Failed to retrieve updated skill progress record');
    }

    const updated = freshRecord[0];
    this.logger.debug(`Updated record from database:`, JSON.stringify(updated));

    // Get enrollment ID and student name - ensure it belongs to teacher's class
    const enrollmentRaw = await this.enrollmentRepository.query(
      `SELECT e.id as enrollment_id, l.child_name
       FROM enrollment e
       LEFT JOIN leads l ON l.id = e.lead_id
       JOIN classes c ON c.id = e.class_id
       WHERE e.lead_id = $1 AND e.status = 'active' AND c.teacher_id = $2
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [leadId, teacherId],
    );

    const enrollmentId = enrollmentRaw?.[0]?.enrollment_id || leadId;
    const studentName = enrollmentRaw?.[0]?.child_name || 'Unknown Student';

    // Use the fresh database values directly - they should have the updated values
    const response: SkillProgressResponseDto = {
      id: updated.id || recordId,
      studentId: enrollmentId,
      studentName: studentName,
      teacherId: updated.teacher_id || teacherId,
      skillArea: updated.skill_area || '',
      skillName: updated.skill_name || '',
      currentLevel: Number(updated.current_level) || 1,
      targetLevel: Number(updated.target_level) || 5,
      observation: updated.observation || '',
      milestoneAchieved: Boolean(updated.milestone_achieved),
      recordedDate: updated.recorded_date instanceof Date
        ? updated.recorded_date.toISOString().split('T')[0]
        : (updated.recorded_date ? String(updated.recorded_date).split('T')[0] : new Date().toISOString().split('T')[0]),
      nextSteps: updated.next_steps ?? null,
      createdAt: updated.created_at instanceof Date
        ? updated.created_at.toISOString()
        : (updated.created_at ? String(updated.created_at) : new Date().toISOString()),
      updatedAt: updated.updated_at instanceof Date
        ? updated.updated_at.toISOString()
        : (updated.updated_at ? String(updated.updated_at) : new Date().toISOString()),
    };

    this.logger.debug(`Final response:`, JSON.stringify(response));

    this.logger.log(`Updated skill progress record ${recordId} successfully`);
    return response;
  }

  /**
   * Delete a skill progress record
   */
  async deleteSkillProgress(recordId: string, teacherId: string): Promise<void> {
    this.logger.log(`Deleting skill progress record ${recordId} for teacher: ${teacherId}`);

    const record = await this.skillProgressRepository.findOne({
      where: { id: recordId },
    });

    if (!record) {
      throw new NotFoundException('Skill progress record not found');
    }

    // Verify teacher owns the record
    if (record.teacherId !== teacherId) {
      throw new ForbiddenException('You can only delete your own progress records');
    }

    await this.skillProgressRepository.remove(record);
  }

  /**
   * Get all teacher activities
   */
  async getTeacherActivities(teacherId: string): Promise<TeacherActivityResponseDto[]> {
    this.logger.log(`Fetching activities for teacher: ${teacherId}`);

    // Get activities using raw SQL to join with related tables
    const activities = await this.teacherActivityRepository.query(
      `SELECT 
        ta.id, ta.teacher_id, ta.school_id, ta.title, ta.description,
        ta.activity_type, ta.skill_areas, ta.learning_objectives,
        ta.materials_used, ta.reflection, ta.date_completed, ta.duration,
        ta.status, ta.created_at, ta.updated_at
      FROM teacher_activities ta
      WHERE ta.teacher_id = $1
      ORDER BY ta.date_completed DESC, ta.created_at DESC`,
      [teacherId],
    );

    if (activities.length === 0) {
      return [];
    }

    const activityIds = activities.map((a: any) => a.id);
    const placeholders = activityIds.map((_, i) => `$${i + 1}`).join(', ');

    // Get tagged students
    const taggedStudents = await this.enrollmentRepository.query(
      `SELECT 
        tas.activity_id,
        tas.student_id as enrollment_id,
        l.child_name
      FROM teacher_activity_students tas
      JOIN enrollment e ON e.id = tas.student_id
      LEFT JOIN leads l ON l.id = e.lead_id
      WHERE tas.activity_id IN (${placeholders})`,
      activityIds,
    );

    // Get activity files
    const activityFiles = await this.mediaRepository.query(
      `SELECT 
        taf.activity_id,
        m.id as media_id,
        m.file_url,
        m.file_type,
        m.file_name
      FROM teacher_activity_files taf
      JOIN media m ON m.id = taf.media_id
      WHERE taf.activity_id IN (${placeholders})`,
      activityIds,
    );

    // Group tagged students and files by activity_id
    const studentsMap = new Map<string, ActivityTaggedStudentDto[]>();
    const filesMap = new Map<string, ActivityFileDto[]>();

    taggedStudents.forEach((ts: any) => {
      if (!studentsMap.has(ts.activity_id)) {
        studentsMap.set(ts.activity_id, []);
      }
      studentsMap.get(ts.activity_id)!.push({
        enrollmentId: ts.enrollment_id,
        studentName: ts.child_name || 'Unknown Student',
      });
    });

    activityFiles.forEach((af: any) => {
      if (!filesMap.has(af.activity_id)) {
        filesMap.set(af.activity_id, []);
      }
      const fileType = af.file_type?.startsWith('image/') ? 'image' 
        : af.file_type?.startsWith('video/') ? 'video' 
        : 'document';
      filesMap.get(af.activity_id)!.push({
        id: af.media_id,
        url: af.file_url,
        type: fileType,
        fileName: af.file_name || 'Unknown',
      });
    });

    return activities.map((activity: any) => ({
      id: activity.id,
      title: activity.title,
      description: activity.description,
      activityType: activity.activity_type,
      skillAreas: activity.skill_areas || [],
      learningObjectives: activity.learning_objectives,
      materialsUsed: activity.materials_used || [],
      reflection: activity.reflection,
      dateCompleted: activity.date_completed instanceof Date
        ? activity.date_completed.toISOString().split('T')[0]
        : activity.date_completed,
      duration: activity.duration || 30,
      status: activity.status,
      taggedStudents: studentsMap.get(activity.id) || [],
      files: filesMap.get(activity.id) || [],
      teacherId: activity.teacher_id,
      schoolId: activity.school_id,
      createdAt: activity.created_at instanceof Date
        ? activity.created_at.toISOString()
        : activity.created_at,
      updatedAt: activity.updated_at instanceof Date
        ? activity.updated_at.toISOString()
        : activity.updated_at,
    }));
  }

  /**
   * Create a new teacher activity
   */
  async createTeacherActivity(
    teacherId: string,
    dto: CreateTeacherActivityDto,
    files: Express.Multer.File[],
  ): Promise<TeacherActivityResponseDto> {
    this.logger.log(`Creating activity for teacher: ${teacherId}`);

    // Get teacher's school_id
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    // Verify tagged students belong to teacher's classes
    if (dto.taggedStudents && dto.taggedStudents.length > 0) {
      const placeholders = dto.taggedStudents.map((_, i) => `$${i + 1}`).join(', ');
      const studentsCheck = await this.enrollmentRepository.query(
        `SELECT e.id
         FROM enrollment e
         JOIN classes c ON c.id = e.class_id
         WHERE e.id IN (${placeholders}) AND c.teacher_id = $${dto.taggedStudents.length + 1} AND e.status = 'active'`,
        [...dto.taggedStudents, teacherId],
      );

      if (studentsCheck.length !== dto.taggedStudents.length) {
        throw new ForbiddenException('Some tagged students do not belong to your classes');
      }
    }

    // Create activity using raw SQL
    const dateCompleted = dto.dateCompleted ? new Date(dto.dateCompleted).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    
    const activityResult = await this.teacherActivityRepository.query(
      `INSERT INTO teacher_activities (
        teacher_id, school_id, title, description, activity_type,
        skill_areas, learning_objectives, materials_used, reflection,
        date_completed, duration, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING id, teacher_id, school_id, title, description, activity_type,
        skill_areas, learning_objectives, materials_used, reflection,
        date_completed, duration, status, created_at, updated_at`,
      [
        teacherId,
        userRole.schoolId,
        dto.title,
        dto.description || null,
        dto.activityType,
        dto.skillAreas || [],
        dto.learningObjectives || null,
        dto.materialsUsed || [],
        dto.reflection || null,
        dateCompleted,
        dto.duration || 30,
        dto.status || ActivityStatus.DRAFT,
      ],
    );

    const activity = activityResult[0];
    const activityId = activity.id;

    // Upload files to S3 and create media records
    const mediaIds: string[] = [];
    if (files && files.length > 0) {
      for (const file of files) {
        try {
          // Use uploadMedia method similar to uploadTeacherMedia
          const uploadResult = await this.mediaService.uploadMedia(
            file,
            {
              schoolId: userRole.schoolId,
              childId: undefined, // Activities don't have a specific child
              description: `Activity: ${dto.title}`,
              tags: dto.skillAreas || [],
              isFeatured: false,
            },
            teacherId,
          );

          // Link file to activity
          await this.mediaRepository.query(
            `INSERT INTO teacher_activity_files (activity_id, media_id, created_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (activity_id, media_id) DO NOTHING`,
            [activityId, uploadResult.id],
          );

          mediaIds.push(uploadResult.id);
        } catch (error) {
          this.logger.warn(`Failed to upload file ${file.originalname}: ${error}`);
          // Continue with other files
        }
      }
    }

    // Link tagged students
    if (dto.taggedStudents && dto.taggedStudents.length > 0) {
      for (const studentId of dto.taggedStudents) {
        await this.enrollmentRepository.query(
          `INSERT INTO teacher_activity_students (activity_id, student_id, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT DO NOTHING`,
          [activityId, studentId],
        );
      }
    }

    // Fetch complete activity with relations
    return this.getActivityById(activityId, teacherId);
  }

  /**
   * Get a single activity by ID
   */
  private async getActivityById(activityId: string, teacherId: string): Promise<TeacherActivityResponseDto> {
    const activity = await this.teacherActivityRepository.query(
      `SELECT * FROM teacher_activities WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
      [activityId, teacherId],
    );

    if (!activity || activity.length === 0) {
      throw new NotFoundException('Activity not found');
    }

    const act = activity[0];

    // Get tagged students
    const taggedStudents = await this.enrollmentRepository.query(
      `SELECT 
        tas.student_id as enrollment_id,
        l.child_name
      FROM teacher_activity_students tas
      JOIN enrollment e ON e.id = tas.student_id
      LEFT JOIN leads l ON l.id = e.lead_id
      WHERE tas.activity_id = $1`,
      [activityId],
    );

    // Get activity files
    const activityFiles = await this.mediaRepository.query(
      `SELECT 
        m.id as media_id,
        m.file_url,
        m.file_type,
        m.file_name
      FROM teacher_activity_files taf
      JOIN media m ON m.id = taf.media_id
      WHERE taf.activity_id = $1`,
      [activityId],
    );

    return {
      id: act.id,
      title: act.title,
      description: act.description,
      activityType: act.activity_type,
      skillAreas: act.skill_areas || [],
      learningObjectives: act.learning_objectives,
      materialsUsed: act.materials_used || [],
      reflection: act.reflection,
      dateCompleted: act.date_completed instanceof Date
        ? act.date_completed.toISOString().split('T')[0]
        : act.date_completed,
      duration: act.duration || 30,
      status: act.status,
      taggedStudents: taggedStudents.map((ts: any) => ({
        enrollmentId: ts.enrollment_id,
        studentName: ts.child_name || 'Unknown Student',
      })),
      files: activityFiles.map((af: any) => {
        const fileType = af.file_type?.startsWith('image/') ? 'image' 
          : af.file_type?.startsWith('video/') ? 'video' 
          : 'document';
        return {
          id: af.media_id,
          url: af.file_url,
          type: fileType,
          fileName: af.file_name || 'Unknown',
        };
      }),
      teacherId: act.teacher_id,
      schoolId: act.school_id,
      createdAt: act.created_at instanceof Date
        ? act.created_at.toISOString()
        : act.created_at,
      updatedAt: act.updated_at instanceof Date
        ? act.updated_at.toISOString()
        : act.updated_at,
    };
  }

  /**
   * Update a teacher activity
   */
  async updateTeacherActivity(
    activityId: string,
    teacherId: string,
    dto: UpdateTeacherActivityDto,
  ): Promise<TeacherActivityResponseDto> {
    this.logger.log(`Updating activity ${activityId} for teacher: ${teacherId}`);

    // Verify activity exists and belongs to teacher
    const existing = await this.teacherActivityRepository.query(
      `SELECT id FROM teacher_activities WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
      [activityId, teacherId],
    );

    if (!existing || existing.length === 0) {
      throw new NotFoundException('Activity not found or you do not have access');
    }

    // Build update query dynamically
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (dto.title !== undefined) {
      updateFields.push(`title = $${paramIndex++}`);
      updateValues.push(dto.title);
    }
    if (dto.description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      updateValues.push(dto.description);
    }
    if (dto.activityType !== undefined) {
      updateFields.push(`activity_type = $${paramIndex++}`);
      updateValues.push(dto.activityType);
    }
    if (dto.skillAreas !== undefined) {
      updateFields.push(`skill_areas = $${paramIndex++}`);
      updateValues.push(dto.skillAreas);
    }
    if (dto.learningObjectives !== undefined) {
      updateFields.push(`learning_objectives = $${paramIndex++}`);
      updateValues.push(dto.learningObjectives);
    }
    if (dto.materialsUsed !== undefined) {
      updateFields.push(`materials_used = $${paramIndex++}`);
      updateValues.push(dto.materialsUsed);
    }
    if (dto.reflection !== undefined) {
      updateFields.push(`reflection = $${paramIndex++}`);
      updateValues.push(dto.reflection);
    }
    if (dto.dateCompleted !== undefined) {
      updateFields.push(`date_completed = $${paramIndex++}`);
      updateValues.push(new Date(dto.dateCompleted).toISOString().split('T')[0]);
    }
    if (dto.duration !== undefined) {
      updateFields.push(`duration = $${paramIndex++}`);
      updateValues.push(dto.duration);
    }
    if (dto.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      updateValues.push(dto.status);
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at = NOW()`);
      updateValues.push(activityId);

      await this.teacherActivityRepository.query(
        `UPDATE teacher_activities
         SET ${updateFields.join(', ')}
         WHERE id = $${paramIndex}`,
        updateValues,
      );
    }

    // Update tagged students if provided
    if (dto.taggedStudents !== undefined) {
      // Verify students belong to teacher's classes
      if (dto.taggedStudents.length > 0) {
        const placeholders = dto.taggedStudents.map((_, i) => `$${i + 1}`).join(', ');
        const studentsCheck = await this.enrollmentRepository.query(
          `SELECT e.id
           FROM enrollment e
           JOIN classes c ON c.id = e.class_id
           WHERE e.id IN (${placeholders}) AND c.teacher_id = $${dto.taggedStudents.length + 1} AND e.status = 'active'`,
          [...dto.taggedStudents, teacherId],
        );

        if (studentsCheck.length !== dto.taggedStudents.length) {
          throw new ForbiddenException('Some tagged students do not belong to your classes');
        }
      }

      // Delete existing tags
      await this.enrollmentRepository.query(
        `DELETE FROM teacher_activity_students WHERE activity_id = $1`,
        [activityId],
      );

      // Insert new tags
      for (const studentId of dto.taggedStudents) {
        await this.enrollmentRepository.query(
          `INSERT INTO teacher_activity_students (activity_id, student_id, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT DO NOTHING`,
          [activityId, studentId],
        );
      }
    }

    return this.getActivityById(activityId, teacherId);
  }

  /**
   * Update activity status
   */
  async updateActivityStatus(
    activityId: string,
    status: ActivityStatus,
    teacherId: string,
  ): Promise<TeacherActivityResponseDto> {
    this.logger.log(`Updating activity ${activityId} status to ${status} for teacher: ${teacherId}`);

    const result = await this.teacherActivityRepository.query(
      `UPDATE teacher_activities
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND teacher_id = $3
       RETURNING id`,
      [status, activityId, teacherId],
    );

    if (!result || result.length === 0) {
      throw new NotFoundException('Activity not found or you do not have access');
    }

    return this.getActivityById(activityId, teacherId);
  }

  /**
   * Delete a teacher activity
   */
  async deleteTeacherActivity(activityId: string, teacherId: string): Promise<void> {
    this.logger.log(`Deleting activity ${activityId} for teacher: ${teacherId}`);

    const result = await this.teacherActivityRepository.query(
      `SELECT id FROM teacher_activities WHERE id = $1 AND teacher_id = $2 LIMIT 1`,
      [activityId, teacherId],
    );

    if (!result || result.length === 0) {
      throw new NotFoundException('Activity not found or you do not have access');
    }

    // Delete activity (cascade will delete related records in junction tables)
    await this.teacherActivityRepository.query(
      `DELETE FROM teacher_activities WHERE id = $1`,
      [activityId],
    );
  }

  /**
   * Get schedule events for a teacher within a date range
   */
  async getScheduleEvents(
    teacherId: string,
    startDate: string,
    endDate: string,
  ): Promise<ScheduleEventResponseDto[]> {
    this.logger.log(`Fetching schedule events for teacher: ${teacherId} from ${startDate} to ${endDate}`);

    // Parse dates and set time to start/end of day for proper range comparison
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const events = await this.scheduleEventRepository.find({
      where: {
        teacherId,
        eventDate: Between(start, end),
      },
      order: {
        eventDate: 'ASC',
        startTime: 'ASC',
      },
    });

    return events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      eventDate: event.eventDate instanceof Date
        ? event.eventDate.toISOString().split('T')[0]
        : event.eventDate,
      startTime: event.startTime,
      endTime: event.endTime,
      eventType: event.eventType,
      location: event.location,
      notes: event.notes,
      recurring: event.recurring,
      teacherId: event.teacherId,
      schoolId: event.schoolId,
      classId: event.classId,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    }));
  }

  /**
   * Create a new schedule event
   */
  async createScheduleEvent(
    teacherId: string,
    dto: CreateScheduleEventDto,
  ): Promise<ScheduleEventResponseDto> {
    this.logger.log(`Creating schedule event for teacher: ${teacherId}`);

    // Get teacher's school_id
    const userRole = await this.userRoleRepository.findOne({
      where: { userId: teacherId },
      select: ['schoolId'],
    });

    if (!userRole?.schoolId) {
      throw new NotFoundException('Teacher school not found');
    }

    const event = this.scheduleEventRepository.create({
      teacherId,
      schoolId: userRole.schoolId,
      classId: dto.classId || null,
      title: dto.title,
      description: dto.description || null,
      eventDate: new Date(dto.eventDate),
      startTime: dto.startTime,
      endTime: dto.endTime,
      eventType: dto.eventType,
      location: dto.location || null,
      notes: dto.notes || null,
      recurring: dto.recurring || false,
    });

    const saved = await this.scheduleEventRepository.save(event);

    return {
      id: saved.id,
      title: saved.title,
      description: saved.description,
      eventDate: saved.eventDate instanceof Date
        ? saved.eventDate.toISOString().split('T')[0]
        : saved.eventDate,
      startTime: saved.startTime,
      endTime: saved.endTime,
      eventType: saved.eventType,
      location: saved.location,
      notes: saved.notes,
      recurring: saved.recurring,
      teacherId: saved.teacherId,
      schoolId: saved.schoolId,
      classId: saved.classId,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  /**
   * Update a schedule event
   */
  async updateScheduleEvent(
    eventId: string,
    teacherId: string,
    dto: UpdateScheduleEventDto,
  ): Promise<ScheduleEventResponseDto> {
    this.logger.log(`Updating schedule event ${eventId} for teacher: ${teacherId}`);

    const event = await this.scheduleEventRepository.findOne({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Schedule event not found');
    }

    // Verify teacher owns the event
    if (event.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update your own schedule events');
    }

    // Update fields
    if (dto.title !== undefined) event.title = dto.title;
    if (dto.description !== undefined) event.description = dto.description;
    if (dto.eventDate !== undefined) event.eventDate = new Date(dto.eventDate);
    if (dto.startTime !== undefined) event.startTime = dto.startTime;
    if (dto.endTime !== undefined) event.endTime = dto.endTime;
    if (dto.eventType !== undefined) event.eventType = dto.eventType;
    if (dto.classId !== undefined) event.classId = dto.classId || null;
    if (dto.location !== undefined) event.location = dto.location;
    if (dto.notes !== undefined) event.notes = dto.notes;
    if (dto.recurring !== undefined) event.recurring = dto.recurring;

    const updated = await this.scheduleEventRepository.save(event);

    return {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      eventDate: updated.eventDate instanceof Date
        ? updated.eventDate.toISOString().split('T')[0]
        : updated.eventDate,
      startTime: updated.startTime,
      endTime: updated.endTime,
      eventType: updated.eventType,
      location: updated.location,
      notes: updated.notes,
      recurring: updated.recurring,
      teacherId: updated.teacherId,
      schoolId: updated.schoolId,
      classId: updated.classId,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Get class schedule for parent (view their child's class schedule)
   */
  async getClassScheduleForParent(
    parentId: string,
    classId: string,
    startDate: string,
    endDate: string,
  ): Promise<ScheduleEventResponseDto[]> {
    this.logger.log(`Fetching class schedule for parent ${parentId}, class ${classId}`);

    // Verify parent has a child in this class via enrollment
    const enrollment = await this.enrollmentRepository
      .createQueryBuilder('enrollment')
      .innerJoin('parent_students', 'ps', 'ps.student_id = enrollment.lead_id')
      .where('ps.parent_id = :parentId', { parentId })
      .andWhere('enrollment.class_id = :classId', { classId })
      .andWhere('enrollment.status = :status', { status: EnrollmentStatus.ACTIVE })
      .getOne();

    if (!enrollment) {
      throw new ForbiddenException('You do not have access to this class schedule');
    }

    // Parse dates
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Get all schedule events for this class (from any teacher)
    const events = await this.scheduleEventRepository.find({
      where: {
        classId,
        eventDate: Between(start, end),
      },
      order: {
        eventDate: 'ASC',
        startTime: 'ASC',
      },
    });

    return events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      eventDate: event.eventDate instanceof Date
        ? event.eventDate.toISOString().split('T')[0]
        : event.eventDate,
      startTime: event.startTime,
      endTime: event.endTime,
      eventType: event.eventType,
      location: event.location,
      notes: event.notes,
      recurring: event.recurring,
      teacherId: event.teacherId,
      schoolId: event.schoolId,
      classId: event.classId,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    }));
  }

  /**
   * Delete a schedule event
   */
  async deleteScheduleEvent(eventId: string, teacherId: string): Promise<void> {
    this.logger.log(`Deleting schedule event ${eventId} for teacher: ${teacherId}`);

    const event = await this.scheduleEventRepository.findOne({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Schedule event not found');
    }

    // Verify teacher owns the event
    if (event.teacherId !== teacherId) {
      throw new ForbiddenException('You can only delete your own schedule events');
    }

    await this.scheduleEventRepository.remove(event);
  }
}

