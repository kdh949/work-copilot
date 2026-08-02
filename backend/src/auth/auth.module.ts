import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSession } from './entities/auth-session.entity';
import { OidcAuthorizationAttempt } from './entities/oidc-authorization-attempt.entity';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { WorkCopilotAdminGuard } from './guards/work-copilot-admin.guard';
import { OidcAttemptCryptoService } from './oidc/oidc-attempt-crypto.service';
import { KeycloakOidcService } from './oidc/keycloak-oidc.service';
import { SessionService } from './session/session.service';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([AuthSession, OidcAuthorizationAttempt]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    KeycloakOidcService,
    OidcAttemptCryptoService,
    SessionService,
    SessionAuthGuard,
    WorkCopilotAdminGuard,
  ],
  exports: [SessionAuthGuard, SessionService, WorkCopilotAdminGuard],
})
export class AuthModule {}
