import {
    Injectable,
    ExecutionContext,
    UnauthorizedException,
    Logger,
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { Reflector } from '@nestjs/core';
  import { Observable } from 'rxjs';
  
  @Injectable()
  export class JwtAuthGuard extends AuthGuard('jwt') {
    private readonly logger = new Logger(JwtAuthGuard.name);

    constructor(private reflector: Reflector) {
      super();
    }
  
    canActivate(
      context: ExecutionContext,
    ): boolean | Promise<boolean> | Observable<boolean> {
      const request = context.switchToHttp().getRequest();
      
      // Check if route is marked as public
      const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
        context.getHandler(),
        context.getClass(),
      ]);
  
      if (isPublic) {
        return true;
      }
  
      return super.canActivate(context);
    }
  
    handleRequest(err, user, info) {
      if (info) {
        this.logger.warn(`⚠️ Passport info: ${JSON.stringify(info)}`);
      }

      if (err) {
        this.logger.error(`❌ Error in authentication: ${err.message}`);
        this.logger.error(`Error stack: ${err.stack}`);
        throw err;
      }

      if (!user) {
        this.logger.error(`❌ No user returned from JWT strategy`);
        this.logger.error(`Info object: ${JSON.stringify(info)}`);
        throw new UnauthorizedException('Authentication required');
      }

      return user;
    }
  }