import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../../security/jwt-auth.guard';
import { ProtectModule } from '../protect/protect.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasher } from './crypto/password.hasher';
import { RefreshTokenHasher } from './crypto/refresh-token.hasher';
import { UserEntity } from './entities/user.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { TokenService } from './jwt/token.service';
import { SessionRepository } from './repositories/session.repository';
import { UserRepository } from './repositories/user.repository';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, UserSessionEntity]), ProtectModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordHasher,
    RefreshTokenHasher,
    UserRepository,
    SessionRepository,
    // Global JWT authentication guard (mirrors Spring Security anyExchange().authenticated()).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  // Exported so the global guard (and other modules) can resolve token/session dependencies.
  exports: [TokenService, SessionRepository, UserRepository],
})
export class MemberModule {}
