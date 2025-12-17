import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Profile } from './entities/profile.entity';
import { UserRole } from './entities/user-role.entity';
import { AppRole } from '../common/enums/app-role.enum';

export interface CreateUserDto {
  email: string;
  passwordHash: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: AppRole;
  schoolId?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Profile)
    private profilesRepository: Repository<Profile>,
    @InjectRepository(UserRole)
    private userRolesRepository: Repository<UserRole>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const newUser = this.usersRepository.create({
      email: createUserDto.email,
      passwordHash: createUserDto.passwordHash,
      emailVerified: false,
      status: 'active',
    });

    const savedUser = await this.usersRepository.save(newUser);

    // Create profile
    const profile = this.profilesRepository.create({
      id: savedUser.id,
      email: savedUser.email,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      phone: createUserDto.phone,
      schoolId: createUserDto.schoolId,
      status: 'active',
    });
    await this.profilesRepository.save(profile);

    // Create user role if provided
    if (createUserDto.role) {
      const userRole = this.userRolesRepository.create({
        userId: savedUser.id,
        role: createUserDto.role,
        schoolId: createUserDto.schoolId || null,
      });
      await this.userRolesRepository.save(userRole);
    }

    // Load relations
    const user = await this.findById(savedUser.id);
    if (!user) {
      throw new Error('Failed to create user');
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email },
      relations: ['profile', 'roles'],
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      relations: ['profile', 'roles'],
    });
  }

  async findProfileById(userId: string): Promise<Profile | null> {
    return this.profilesRepository.findOne({
      where: { id: userId },
    });
  }

  async findRolesByUserId(userId: string): Promise<UserRole[]> {
    return this.userRolesRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.usersRepository.update(userId, {
      lastLoginAt: new Date(),
    });
  }

  async getUserRole(userId: string): Promise<string | null> {
    const user = await this.findById(userId);
    if (!user || !user.roles || user.roles.length === 0) {
      return null;
    }
    // Return primary role (first role)
    return user.roles[0].role;
  }
}


