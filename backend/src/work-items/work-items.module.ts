import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsOAuthModule } from '../integrations/oauth/integrations-oauth.module';
import { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import { IntegrationProfilesModule } from '../integrations/profiles/integration-profiles.module';
import { AtlassianReadClientService } from './atlassian-read-client.service';
import { ConfluenceWorkItemService } from './confluence/confluence-work-item.service';
import { IntegrationAccessPolicyService } from './integration-access-policy.service';
import { JiraWorkItemService } from './jira/jira-work-item.service';
import { WorkItemsController } from './work-items.controller';

@Module({
  imports: [
    AuthModule,
    IntegrationsOAuthModule,
    IntegrationProfilesModule,
    TypeOrmModule.forFeature([IntegrationProfile]),
  ],
  controllers: [WorkItemsController],
  providers: [
    IntegrationAccessPolicyService,
    AtlassianReadClientService,
    JiraWorkItemService,
    ConfluenceWorkItemService,
  ],
})
export class WorkItemsModule {}
