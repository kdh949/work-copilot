import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import {
  SessionAuthGuard,
  type AuthenticatedRequest,
} from '../../auth/guards/session-auth.guard';
import { parseFrontendOrigins } from '../../config/security.config';
import type { CorrelatedRequest } from '../../common/http/correlation-id.middleware';
import { OAuthCallbackDto } from './dto/oauth-callback.dto';
import { IntegrationsOAuthService } from './integrations-oauth.service';

type IntegrationRequest = AuthenticatedRequest & CorrelatedRequest;

@Controller('integrations')
@UseGuards(SessionAuthGuard)
export class IntegrationsOAuthController {
  constructor(
    private readonly integrationsOAuthService: IntegrationsOAuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  list(@Req() request: IntegrationRequest) {
    return this.integrationsOAuthService.list(request.user.sub);
  }

  @Post(':provider/authorize')
  authorize(
    @Param('provider') provider: string,
    @Req() request: IntegrationRequest,
  ) {
    return this.integrationsOAuthService.createAuthorizationUrl(
      provider,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() callback: OAuthCallbackDto,
    @Req() request: IntegrationRequest,
    @Res() response: Response,
  ): Promise<void> {
    await this.integrationsOAuthService.completeAuthorization(
      provider,
      callback.code,
      callback.state,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
    response.redirect(
      parseFrontendOrigins(
        this.configService.get<string>('FRONTEND_ORIGINS'),
      )[0],
    );
  }

  @Delete(':provider')
  @HttpCode(204)
  async disconnect(
    @Param('provider') provider: string,
    @Req() request: IntegrationRequest,
  ): Promise<void> {
    await this.integrationsOAuthService.disconnect(
      provider,
      request.user.sub,
      request.correlationId ?? 'missing-correlation-id',
    );
  }
}
