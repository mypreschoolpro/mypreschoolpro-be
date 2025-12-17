 import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { ProfileEntity } from './entities/profile.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { AppRole } from '../../common/enums/app-role.enum';
import { StaffInvitation } from './entities/staff-invitation.entity';
import { SchoolEntity } from '../schools/entities/school.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

interface ProfileQueryOptions {
  status?: string;
  schoolId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
  order?: 'ASC' | 'DESC';
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(ProfileEntity)
    private readonly profileRepository: Repository<ProfileEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepository: Repository<UserRoleEntity>,
    @InjectRepository(StaffInvitation)
    private readonly staffInvitationRepository: Repository<StaffInvitation>,
    @InjectRepository(SchoolEntity)
    private readonly schoolRepository: Repository<SchoolEntity>,
    private readonly configService: ConfigService,
  ) {}

  async findProfileById(userId: string): Promise<ProfileEntity | null> {
    return this.profileRepository.findOne({ where: { id: userId } });
  }

  /**
   * Get the school associated with the user's role
   * For school_admin, admissions_staff, teacher: returns their assigned school
   * For school_owner: returns the first school they own
   * For super_admin: returns null (they can access all schools)
   */
  async findSchoolByUser(userId: string, role?: AppRole): Promise<SchoolEntity | null> {
    // If specific role provided, prioritize that role
    if (role) {
      const userRole = await this.userRoleRepository.findOne({
        where: { userId, role },
        order: { createdAt: 'ASC' },
      });

      if (userRole?.schoolId) {
        return this.schoolRepository.findOne({ where: { id: userRole.schoolId } });
      }
    }

    // Otherwise, try to find any role with a school assignment
    // Priority: school_admin > admissions_staff > teacher
    const priorityRoles = [AppRole.SCHOOL_ADMIN, AppRole.ADMISSIONS_STAFF, AppRole.TEACHER];
    for (const priorityRole of priorityRoles) {
      const userRole = await this.userRoleRepository.findOne({
        where: { userId, role: priorityRole },
        order: { createdAt: 'ASC' },
      });

      if (userRole?.schoolId) {
        return this.schoolRepository.findOne({ where: { id: userRole.schoolId } });
      }
    }

    // If no school in role, check if user is a school owner
    const ownedSchool = await this.schoolRepository.findOne({
      where: { ownerId: userId },
      order: { createdAt: 'ASC' },
    });

    return ownedSchool || null;
  }

  async upsertProfile(profile: Partial<ProfileEntity>): Promise<ProfileEntity> {
    return this.profileRepository.save(
      this.profileRepository.create(profile),
    );
  }

  async findRolesByUserId(userId: string): Promise<UserRoleEntity[]> {
    return this.userRoleRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Find user by email (for authentication)
   * Uses Supabase Auth to find user, then loads profile and roles
   */
  async findByEmail(email: string): Promise<any | null> {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      this.logger.warn('Supabase credentials not configured, falling back to profile lookup');
      // Fallback: find by profile email
      const profile = await this.profileRepository.findOne({ where: { email } });
      if (!profile) return null;

      const roles = await this.findRolesByUserId(profile.id);
      return {
        id: profile.id,
        email: profile.email,
        passwordHash: null, // Not available in Supabase Auth
        status: profile.status || 'active',
        roles,
        profile,
      };
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Find user in Supabase Auth
    const { data: authUsers, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) {
      this.logger.error(`Error fetching users: ${error.message}`);
      return null;
    }

    const authUser = authUsers.users.find((u) => u.email === email.toLowerCase());
    if (!authUser) return null;

    // Load profile and roles
    const profile = await this.findProfileById(authUser.id);
    const roles = await this.findRolesByUserId(authUser.id);

    return {
      id: authUser.id,
      email: authUser.email,
      passwordHash: null, // Supabase Auth handles passwords
      emailVerified: authUser.email_confirmed_at !== null,
      emailVerifiedAt: authUser.email_confirmed_at ? new Date(authUser.email_confirmed_at) : null,
      lastLoginAt: authUser.last_sign_in_at ? new Date(authUser.last_sign_in_at) : null,
      status: profile?.status || 'active',
      roles,
      profile,
    };
  }

  /**
   * Find user by ID (for authentication)
   */
  async findById(id: string): Promise<any | null> {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      // Fallback: find by profile
      const profile = await this.findProfileById(id);
      if (!profile) return null;

      const roles = await this.findRolesByUserId(id);
      return {
        id: profile.id,
        email: profile.email,
        passwordHash: null,
        status: profile.status || 'active',
        roles,
        profile,
      };
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(id);
    if (error || !authUser.user) {
      this.logger.error(`Error fetching user: ${error?.message}`);
      return null;
    }

    const profile = await this.findProfileById(id);
    const roles = await this.findRolesByUserId(id);

    return {
      id: authUser.user.id,
      email: authUser.user.email,
      passwordHash: null,
      emailVerified: authUser.user.email_confirmed_at !== null,
      emailVerifiedAt: authUser.user.email_confirmed_at ? new Date(authUser.user.email_confirmed_at) : null,
      lastLoginAt: authUser.user.last_sign_in_at ? new Date(authUser.user.last_sign_in_at) : null,
      status: profile?.status || 'active',
      roles,
      profile,
    };
  }

  /**
   * Create a new user (for registration)
   * Creates user in Supabase Auth and profile in database
   * Note: password should be plain text - Supabase Auth handles hashing
   */
  async create(createUserDto: {
    email: string;
    password: string; // Plain password - Supabase Auth will hash it
    firstName?: string;
    lastName?: string;
    phone?: string;
    role?: AppRole;
    schoolId?: string;
  }): Promise<any> {
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new BadRequestException('Supabase credentials not configured');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: createUserDto.email.toLowerCase(),
      password: createUserDto.password, // Supabase Auth handles password hashing
      email_confirm: true, // Auto-confirm for registration
    });

    if (authError || !authData.user) {
      throw new BadRequestException(`Failed to create user: ${authError?.message}`);
    }

    const userId = authData.user.id;

    // Create profile
    const profile = await this.upsertProfile({
      id: userId,
      email: createUserDto.email.toLowerCase(),
      firstName: createUserDto.firstName || null,
      lastName: createUserDto.lastName || null,
      phone: createUserDto.phone || null,
      schoolId: createUserDto.schoolId || null,
      status: 'active',
    });

    // Create user role if provided
    let roles: UserRoleEntity[] = [];
    if (createUserDto.role) {
      const role = await this.assignRole(userId, createUserDto.role, createUserDto.schoolId || null);
      roles = [role];
    }

    return {
      id: userId,
      email: createUserDto.email,
      passwordHash: null, // Not stored in our DB
      status: 'active',
      roles,
      profile,
    };
  }

  /**
   * Update last login timestamp and increment login count
   */
  async updateLastLogin(userId: string): Promise<void> {
    // Get current login count
    const profile = await this.profileRepository.findOne({ where: { id: userId } });
    const currentLoginCount = profile?.loginCount || 0;
    
    // Update profile's updated_at and increment login count
    await this.profileRepository.update(userId, {
      updatedAt: new Date(),
      loginCount: currentLoginCount + 1,
    });
  }

  /**
   * Get user's primary role
   */
  async getUserRole(userId: string): Promise<string | null> {
    const roles = await this.findRolesByUserId(userId);
    if (!roles || roles.length === 0) {
      return null;
    }
    return roles[0].role;
  }

  /**
   * Get roles for multiple users (batch)
   */
  /**
   * Get login counts for multiple users (batch)
   */
  async getLoginCountsByUserIds(userIds: string[]): Promise<Record<string, number>> {
    if (userIds.length === 0) {
      return {};
    }

    const profiles = await this.profileRepository.find({
      where: { id: In(userIds) },
      select: ['id', 'loginCount'],
    });

    const loginCountsMap: Record<string, number> = {};
    profiles.forEach((profile) => {
      loginCountsMap[profile.id] = profile.loginCount || 0;
    });

    // Ensure all requested userIds are in the map (set to 0 if not found)
    userIds.forEach((userId) => {
      if (!(userId in loginCountsMap)) {
        loginCountsMap[userId] = 0;
      }
    });

    return loginCountsMap;
  }

  async findRolesByUserIds(userIds: string[]): Promise<Record<string, UserRoleEntity[]>> {
    if (userIds.length === 0) {
      return {};
    }

    const roles = await this.userRoleRepository.find({
      where: { userId: In(userIds) },
      order: { userId: 'ASC', createdAt: 'ASC' },
    });

    const result: Record<string, UserRoleEntity[]> = {};
    userIds.forEach((id) => {
      result[id] = [];
    });

    roles.forEach((role) => {
      if (!result[role.userId]) {
        result[role.userId] = [];
      }
      result[role.userId].push(role);
    });

    return result;
  }

  async findStaffBySchool(schoolId: string, roles?: AppRole[]): Promise<UserRoleEntity[]> {
    const query = this.userRoleRepository
      .createQueryBuilder('role')
      .leftJoinAndSelect('role.profile', 'profile')
      .where('role.school_id = :schoolId', { schoolId });

    if (roles && roles.length > 0) {
      query.andWhere('role.role IN (:...roles)', { roles });
    }

    return query.orderBy('profile.firstName', 'ASC').getMany();
  }

  async assignRole(userId: string, role: AppRole, schoolId?: string | null): Promise<UserRoleEntity> {
    const entity = this.userRoleRepository.create({
      userId,
      role,
      schoolId: schoolId ?? null,
    });

    return this.userRoleRepository.save(entity);
  }

  async removeRole(roleId: string): Promise<void> {
    await this.userRoleRepository.delete(roleId);
  }

  async hasRole(userId: string, role: AppRole, schoolId?: string | null): Promise<boolean> {
    const query = this.userRoleRepository
      .createQueryBuilder('role')
      .where('role.user_id = :userId', { userId })
      .andWhere('role.role = :role', { role });

    if (schoolId === undefined) {
      // no additional filter
    } else if (schoolId === null) {
      query.andWhere('role.school_id IS NULL');
    } else {
      query.andWhere('role.school_id = :schoolId', { schoolId });
    }

    const count = await query.getCount();
    return count > 0;
  }

  async upsertRoles(userId: string, roles: Array<{ role: AppRole; schoolId?: string | null }>): Promise<UserRoleEntity[]> {
    await this.userRoleRepository.delete({ userId });

    const entities = roles.map((role) =>
      this.userRoleRepository.create({
        userId,
        role: role.role,
        schoolId: role.schoolId ?? null,
      }),
    );

    return this.userRoleRepository.save(entities);
  }

  async findManyProfiles(userIds: string[]): Promise<ProfileEntity[]> {
    if (!userIds.length) {
      return [];
    }

    return this.profileRepository.find({
      where: { id: In(userIds) },
    });
  }

  async updateProfileNames(userId: string, firstName?: string | null, lastName?: string | null): Promise<ProfileEntity | null> {
    if (firstName === undefined && lastName === undefined) {
      return this.findProfileById(userId);
    }

    await this.profileRepository.update(userId, {
      firstName: firstName ?? null,
      lastName: lastName ?? null,
    });

    return this.findProfileById(userId);
  }

  async updateProfileStatus(userId: string, status: string): Promise<ProfileEntity | null> {
    await this.profileRepository.update(userId, { status });
    return this.findProfileById(userId);
  }

  async findRoleById(roleId: string): Promise<UserRoleEntity | null> {
    return this.userRoleRepository.findOne({ where: { id: roleId } });
  }

  async updateStaffRole(roleId: string, role: AppRole): Promise<UserRoleEntity | null> {
    const result = await this.userRoleRepository.findOne({ where: { id: roleId } });
    if (!result) {
      return null;
    }

    result.role = role;
    return this.userRoleRepository.save(result);
  }

  async getPendingStaffInvitations(schoolId: string): Promise<StaffInvitation[]> {
    return this.staffInvitationRepository.find({
      where: {
        schoolId,
        acceptedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async createStaffInvitation(params: {
    schoolId: string;
    email: string;
    role: AppRole;
    invitedBy: string;
    token: string;
    expiresAt?: Date;
  }): Promise<StaffInvitation> {
    const invitation = this.staffInvitationRepository.create({
      schoolId: params.schoolId,
      invitedEmail: params.email.toLowerCase(),
      invitedRole: params.role,
      invitedBy: params.invitedBy,
      invitationToken: params.token,
      expiresAt:
        params.expiresAt ||
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return this.staffInvitationRepository.save(invitation);
  }

  async findInvitationById(id: string): Promise<StaffInvitation | null> {
    return this.staffInvitationRepository.findOne({ where: { id } });
  }

  async deleteInvitation(id: string): Promise<void> {
    await this.staffInvitationRepository.delete(id);
  }

  async findProfileByEmail(email: string): Promise<ProfileEntity | null> {
    if (!email) {
      return null;
    }

    return this.profileRepository.findOne({
      where: { email: email.toLowerCase() },
      select: ['id', 'email', 'firstName', 'lastName'],
    });
  }

  async findProfiles(options: ProfileQueryOptions = {}): Promise<{ data: ProfileEntity[]; total: number }> {
    const query = this.profileRepository.createQueryBuilder('profile');

    if (options.status) {
      query.andWhere('profile.status = :status', { status: options.status });
    }

    if (options.schoolId) {
      query.andWhere('profile.school_id = :schoolId', { schoolId: options.schoolId });
    }

    if (options.createdAfter) {
      query.andWhere('profile.created_at >= :createdAfter', { createdAfter: options.createdAfter });
    }

    if (options.createdBefore) {
      query.andWhere('profile.created_at <= :createdBefore', { createdBefore: options.createdBefore });
    }

    query.orderBy('profile.created_at', options.order ?? 'DESC');

    if (options.limit !== undefined) {
      query.take(options.limit);
    }

    if (options.offset !== undefined) {
      query.skip(options.offset);
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total };
  }

  async countUserRoles(roles?: AppRole[]): Promise<number> {
    const queryBuilder = this.userRoleRepository.createQueryBuilder('role');

    if (roles && roles.length > 0) {
      queryBuilder.where('role.role IN (:...roles)', { roles });
    }

    return queryBuilder.getCount();
  }

  async countProfiles(options: Pick<ProfileQueryOptions, 'status' | 'schoolId'> = {}): Promise<number> {
    const query = this.profileRepository.createQueryBuilder('profile');

    if (options.status) {
      query.andWhere('profile.status = :status', { status: options.status });
    }

    if (options.schoolId) {
      query.andWhere('profile.school_id = :schoolId', { schoolId: options.schoolId });
    }

    return query.getCount();
  }

  /**
   * Get all users with their roles and schools (for admin user management)
   * Supports pagination, search, filtering, and sorting
   */
  async findAllUsersWithRolesAndSchools(query?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{
    data: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string;
      status: string;
      createdAt: Date;
      role: AppRole | null;
      schoolId: string | null;
      schoolName: string | null;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = query?.page || 1;
    const limit = query?.limit || 50;
    const skip = (page - 1) * limit;
    const sortBy = query?.sortBy || 'createdAt';
    const sortOrder = query?.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Build query with search and filters
    const queryBuilder = this.profileRepository.createQueryBuilder('profile')
      .select([
        'profile.id',
        'profile.firstName',
        'profile.lastName',
        'profile.email',
        'profile.status',
        'profile.createdAt',
      ]);

    // Apply search filter
    if (query?.search) {
      const searchTerm = `%${query.search}%`;
      queryBuilder.andWhere(
        '(profile.firstName ILIKE :search OR profile.lastName ILIKE :search OR profile.email ILIKE :search)',
        { search: searchTerm }
      );
    }

    // Apply status filter
    if (query?.status) {
      queryBuilder.andWhere('profile.status = :status', { status: query.status });
    }

    // Apply sorting
    const sortFieldMap: Record<string, string> = {
      createdAt: 'profile.createdAt',
      email: 'profile.email',
      firstName: 'profile.firstName',
      lastName: 'profile.lastName',
      status: 'profile.status',
    };
    const sortField = sortFieldMap[sortBy] || 'profile.createdAt';
    queryBuilder.orderBy(sortField, sortOrder);

    // Get total count before pagination
    const total = await queryBuilder.getCount();

    // Apply pagination
    queryBuilder.skip(skip).take(limit);

    // Execute query
    const profiles = await queryBuilder.getMany();

    if (profiles.length === 0) {
      return {
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const userIds = profiles.map((p) => p.id);

    // Fetch all roles for these users
    const roles = await this.userRoleRepository.find({
      where: { userId: In(userIds) },
      select: ['id', 'userId', 'role', 'schoolId'],
    });

    // Fetch all schools
    const schoolIds = roles
      .map((r) => r.schoolId)
      .filter((id): id is string => id !== null);
    const schools =
      schoolIds.length > 0
        ? await this.schoolRepository.find({
            where: { id: In(schoolIds) },
            select: ['id', 'name'],
          })
        : [];

    // Create lookup maps
    const rolesMap = new Map<string, UserRoleEntity>();
    roles.forEach((role) => {
      // Use the first role found (or primary role if available)
      if (!rolesMap.has(role.userId)) {
        rolesMap.set(role.userId, role);
      }
    });

    const schoolsMap = new Map<string, string>();
    schools.forEach((school) => {
      schoolsMap.set(school.id, school.name);
    });

    // Apply role filter after fetching (since roles are in a separate table)
    let combinedData = profiles.map((profile) => {
      const role = rolesMap.get(profile.id);
      const schoolName = role?.schoolId ? schoolsMap.get(role.schoolId) || null : null;

      return {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        status: profile.status,
        createdAt: profile.createdAt,
        role: role?.role || null,
        schoolId: role?.schoolId || null,
        schoolName,
      };
    });

    // Apply role filter if specified
    if (query?.role) {
      combinedData = combinedData.filter((user) => user.role === query.role);
    }

    // Recalculate total if role filter was applied
    let filteredTotal = total;
    if (query?.role) {
      // Need to count all matching profiles with the role filter
      const allProfiles = await this.profileRepository.find({
        select: ['id'],
      });
      const allUserIds = allProfiles.map((p) => p.id);
      const allRoles = await this.userRoleRepository.find({
        where: { userId: In(allUserIds), role: query.role as AppRole },
        select: ['userId'],
      });
      const roleFilteredUserIds = new Set(allRoles.map((r) => r.userId));
      
      // Apply search and status filters to get accurate count
      const countQueryBuilder = this.profileRepository.createQueryBuilder('profile')
        .select('profile.id');
      
      if (query?.search) {
        const searchTerm = `%${query.search}%`;
        countQueryBuilder.andWhere(
          '(profile.firstName ILIKE :search OR profile.lastName ILIKE :search OR profile.email ILIKE :search)',
          { search: searchTerm }
        );
      }
      
      if (query?.status) {
        countQueryBuilder.andWhere('profile.status = :status', { status: query.status });
      }
      
      const allMatchingProfiles = await countQueryBuilder.getMany();
      filteredTotal = allMatchingProfiles.filter((p) => roleFilteredUserIds.has(p.id)).length;
    }

    const totalPages = Math.ceil(filteredTotal / limit);

    return {
      data: combinedData,
      pagination: {
        page,
        limit,
        total: filteredTotal,
        totalPages,
      },
    };
  }

  /**
   * Delete a user (super admin only)
   * This will cascade delete related records (roles, etc.)
   */
  async deleteUser(userId: string): Promise<void> {
    const profile = await this.findProfileById(userId);
    if (!profile) {
      throw new BadRequestException(`User with ID "${userId}" not found`);
    }

    // Delete all roles first (cascade should handle this, but being explicit)
    await this.userRoleRepository.delete({ userId });

    // Delete the profile (this should cascade to other related records)
    await this.profileRepository.delete(userId);
  }

  /**
   * Create a new user (super admin only)
   * Creates user in Supabase Auth, profile, role, and optionally assigns school ownership
   */
  async createUser(createUserDto: CreateUserDto): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: AppRole;
    schoolId: string | null;
    schoolIds: string[];
  }> {
    // Check if user already exists
    const existingProfile = await this.findProfileByEmail(createUserDto.email);
    if (existingProfile) {
      throw new ConflictException('User with this email already exists');
    }

    // Validate school requirements
    const requiresSchool = [
      AppRole.SCHOOL_ADMIN,
      AppRole.ADMISSIONS_STAFF,
      AppRole.TEACHER,
      AppRole.PARENT,
    ].includes(createUserDto.role);

    const isSchoolOwner = createUserDto.role === AppRole.SCHOOL_OWNER;

    if (requiresSchool && !createUserDto.schoolId) {
      throw new BadRequestException(
        `School ID is required for role: ${createUserDto.role}`,
      );
    }

    if (isSchoolOwner && (!createUserDto.schoolIds || createUserDto.schoolIds.length === 0)) {
      throw new BadRequestException(
        'At least one school ID is required for school owner role',
      );
    }

    // Validate schools exist
    if (createUserDto.schoolId) {
      const school = await this.schoolRepository.findOne({
        where: { id: createUserDto.schoolId },
      });
      if (!school) {
        throw new BadRequestException(`School with ID "${createUserDto.schoolId}" not found`);
      }
    }

    if (createUserDto.schoolIds && createUserDto.schoolIds.length > 0) {
      const schools = await this.schoolRepository.find({
        where: { id: In(createUserDto.schoolIds) },
      });
      if (schools.length !== createUserDto.schoolIds.length) {
        throw new BadRequestException('One or more school IDs not found');
      }
    }

    // Get Supabase configuration
    const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new BadRequestException('Supabase configuration missing');
    }

    // Create Supabase Admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Generate temporary password
    const tempPassword = `Temp${Math.random().toString(36).substring(2, 15)}!`;

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: createUserDto.email,
      password: tempPassword,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        first_name: createUserDto.firstName,
        last_name: createUserDto.lastName,
      },
    });

    if (authError || !authData.user) {
      throw new BadRequestException(
        `Failed to create user in Auth: ${authError?.message || 'Unknown error'}`,
      );
    }

    const userId = authData.user.id;

    try {
      // Create/update profile
      await this.upsertProfile({
        id: userId,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        email: createUserDto.email,
        schoolId: requiresSchool && !isSchoolOwner ? createUserDto.schoolId : null,
      });

      // Assign role
      await this.assignRole(
        userId,
        createUserDto.role,
        requiresSchool && !isSchoolOwner ? createUserDto.schoolId : null,
      );

      // Assign school ownership for school owners
      if (isSchoolOwner && createUserDto.schoolIds && createUserDto.schoolIds.length > 0) {
        await this.schoolRepository.update(
          { id: In(createUserDto.schoolIds) },
          { ownerId: userId },
        );
      }

      // Send invitation email if requested
      if (createUserDto.sendInvitation !== false) {
        const appUrl =
          this.configService.get<string>('app.frontendUrl') ||
          this.configService.get<string>('APP_URL', 'http://localhost:5173');
        const redirectUrl = `${appUrl}/auth?mode=reset`;

        await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email: createUserDto.email,
          options: {
            redirectTo: redirectUrl,
          },
        });
      }

      return {
        id: userId,
        email: createUserDto.email,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        role: createUserDto.role,
        schoolId: requiresSchool && !isSchoolOwner ? createUserDto.schoolId || null : null,
        schoolIds: isSchoolOwner ? createUserDto.schoolIds || [] : [],
      };
    } catch (error) {
      // If profile/role creation fails, try to clean up the auth user
      this.logger.error(`Error creating user profile/role: ${error.message}`);
      try {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (deleteError) {
        this.logger.error(`Failed to clean up auth user: ${deleteError.message}`);
      }
      throw error;
    }
  }
}
