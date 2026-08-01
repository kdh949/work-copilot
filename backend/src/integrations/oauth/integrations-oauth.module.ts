import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { IntegrationProfilesModule } from '../profiles/integration-profiles.module';
import { AtlassianOAuthClientService } from './atlassian-oauth-client.service';
import { AtlassianOAuthConnection } from './entities/atlassian-oauth-connection.entity';
import { OAuthAuthorizationAttempt } from './entities/oauth-authorization-attempt.entity';
import { IntegrationsOAuthController } from './integrations-oauth.controller';
import { IntegrationsOAuthService } from './integrations-oauth.service';
import { IntegrationProfile } from '../profiles/entities/integration-profile.entity';
import { SecurityAuditEvent } from '../profiles/entities/security-audit-event.entity';

@Module({
  imports: [
    AuthModule,
    IntegrationProfilesModule,
    TypeOrmModule.forFeature([
      IntegrationProfile,
      SecurityAuditEvent,
      OAuthAuthorizationAttempt,
      AtlassianOAuthConnection,
    ]),
  ],
  controllers: [IntegrationsOAuthController],
  providers: [AtlassianOAuthClientService, IntegrationsOAuthService],
  exports: [IntegrationsOAuthService],
})
export class IntegrationsOAuthModule {}
