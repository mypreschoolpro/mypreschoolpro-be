import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => {
    const dbUrl = process.env.DATABASE_URL;
    
    if (!dbUrl) {
      console.error('❌ DATABASE_URL is not set in environment variables');
      console.error('📝 Please set DATABASE_URL in your .env or .env.local file');
      throw new Error('DATABASE_URL is required');
    }

    return {
      type: 'postgres',
      url: dbUrl,
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      synchronize: false, // NEVER true in production
      logging: false, // Disable query logging to reduce console noise
      ssl: dbUrl.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      migrationsRun: false,
      // Add connection pool settings with timeout
      extra: {
        // Connection pool settings for pg (PostgreSQL driver)
        max: 20, // Maximum number of connections in pool
        connectionTimeoutMillis: 10000, // 10 seconds timeout for new connections
        idleTimeoutMillis: 30000, // 30 seconds idle timeout
        // Query timeout (optional)
        query_timeout: 30000, // 30 seconds for queries
      },
    };
  },
);
