import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { IntegrationProfilesController } from './integration-profiles.controller';
import { IntegrationProfile } from './entities/integration-profile.entity';
import { SecurityAuditEvent } from './entities/security-audit-event.entity';
import { IntegrationProfileConnectionTestService } from './integration-profile-connection-test.service';
import { IntegrationProfileCryptoService } from './integration-profile-crypto.service';
import { IntegrationProfilesService } from './integration-profiles.service';
import { IntegrationProfileUrlPolicy } from './integration-profile-url.policy';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([IntegrationProfile, SecurityAuditEvent]),
  ],
  controllers: [IntegrationProfilesController],
  providers: [
    IntegrationProfilesService,
    IntegrationProfileCryptoService,
    IntegrationProfileUrlPolicy,
    IntegrationProfileConnectionTestService,
  ],
  exports: [IntegrationProfileCryptoService, IntegrationProfileUrlPolicy],
})
export class IntegrationProfilesModule {}
