import { Injectable, UnauthorizedException, Logger, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AuthService } from '../auth.service';
import { AuthUser } from '../interfaces/auth-user.interface';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private authService: AuthService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    const jwtSecret = configService.get<string>('SUPABASE_JWT_SECRET');
    
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      jsonWebTokenOptions: {
        algorithms: ['HS256'],
      },
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload.sub) {
      this.logger.error(`❌ No 'sub' field in JWT payload`);
      throw new UnauthorizedException('Invalid token payload');
    }

    const cacheKey = `auth:user:${payload.sub}`;
    const cachedUser = await this.cacheManager.get<AuthUser>(cacheKey);

    if (cachedUser) {
      return cachedUser;
    }

    const authUser = await this.authService.buildAuthUser(payload.sub, payload.email);

    await this.cacheManager.set(cacheKey, authUser, 600000);

    return authUser;
  }
}