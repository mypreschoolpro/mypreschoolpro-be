import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { ProfileEntity } from '../modules/users/entities/profile.entity';
import { UserRoleEntity } from '../modules/users/entities/user-role.entity';
import { SchoolEntity } from '../modules/schools/entities/school.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dbUrl = configService.get<string>('DATABASE_URL') || 
                     configService.get<string>('SUPABASE_DB_URL');
        
        if (!dbUrl) {
          throw new Error('DATABASE_URL or SUPABASE_DB_URL is not defined');
        }

        // Parse connection string
        const url = new URL(dbUrl);
        
        return {
          type: 'postgres',
          host: url.hostname,
          port: parseInt(url.port) || 5432,
          username: url.username,
          password: url.password,
          database: url.pathname.slice(1) || 'postgres',
          ssl: {
            rejectUnauthorized: false, // Supabase uses SSL
          },
          synchronize: false, // Never auto-sync in production
          logging: false, // Disable query logging to reduce console noise
          entities: [
            ProfileEntity,
            UserRoleEntity,
            SchoolEntity,
            // Add more entities as needed
          ],
          migrations: [__dirname + '/../migrations/*{.ts,.js}'],
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, TypeOrmModule],
})
export class DatabaseModule {}

