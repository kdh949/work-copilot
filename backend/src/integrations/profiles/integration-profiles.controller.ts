import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CorrelatedRequest } from '../../common/http/correlation-id.middleware';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from '../../auth/guards/session-auth.guard';
import { WorkCopilotAdminGuard } from '../../auth/guards/work-copilot-admin.guard';
import { CreateIntegrationProfileDto } from './dto/create-integration-profile.dto';
import { RotateWebhookRouteSecretDto } from './dto/rotate-webhook-route-secret.dto';
import { UpdateIntegrationProfileDto } from './dto/update-integration-profile.dto';
import { IntegrationProfilesService } from './integration-profiles.service';

type AdminRequest = AuthenticatedRequest & CorrelatedRequest;

@Controller('admin/integration-profiles')
@UseGuards(SessionAuthGuard, WorkCopilotAdminGuard)
export class IntegrationProfilesController {
  constructor(private readonly profilesService: IntegrationProfilesService) {}

  @Get()
  findAll() {
    return this.profilesService.findAll();
  }

  @Post()
  create(
    @Body() dto: CreateIntegrationProfileDto,
    @Req() request: AdminRequest,
  ) {
    return this.profilesService.create(
      dto,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationProfileDto,
    @Req() request: AdminRequest,
  ) {
    return this.profilesService.update(
      id,
      dto,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @Req() request: AdminRequest) {
    return this.profilesService.activate(
      id,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @Req() request: AdminRequest) {
    return this.profilesService.deactivate(
      id,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Put(':id/webhook-route-secret')
  rotateWebhookRouteSecret(
    @Param('id') id: string,
    @Body() dto: RotateWebhookRouteSecretDto,
    @Req() request: AdminRequest,
  ) {
    return this.profilesService.rotateWebhookRouteSecret(
      id,
      dto,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Post(':id/test')
  test(@Param('id') id: string, @Req() request: AdminRequest) {
    return this.profilesService.test(
      id,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AdminRequest) {
    return this.profilesService.remove(
      id,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }
}
