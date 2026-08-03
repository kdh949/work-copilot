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
import { ProviderAuthorizationCodeRejectedError } from './atlassian-oauth-client.service';
import { IntegrationsOAuthService } from './integrations-oauth.service';

type IntegrationRequest = AuthenticatedRequest & CorrelatedRequest;
type OAuthCallbackOutcome =
  | 'connected'
  | 'provider_rejected'
  | 'configuration_required'
  | 'token_exchange_failed';

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
    if (provider !== 'jira' && provider !== 'confluence') {
      response.redirect(this.callbackRedirect('jira', 'provider_rejected'));
      return;
    }

    // Never render or log provider-controlled error text. Returning to the
    // product keeps a failed consent/configuration flow actionable without
    // leaking details from Jira or Confluence into an API error response.
    if (callback.error || !callback.code || !callback.state) {
      response.redirect(this.callbackRedirect(provider, 'provider_rejected'));
      return;
    }

    try {
      await this.integrationsOAuthService.completeAuthorization(
        provider,
        callback.code,
        callback.state,
        request.user.sub,
        request.correlationId ?? 'missing-correlation-id',
      );
      response.redirect(this.callbackRedirect(provider, 'connected'));
    } catch (error) {
      response.redirect(
        this.callbackRedirect(provider, this.callbackFailureOutcome(error)),
      );
    }
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

  private callbackRedirect(
    provider: 'jira' | 'confluence',
    outcome: OAuthCallbackOutcome,
  ): string {
    const frontendUrl = new URL(
      parseFrontendOrigins(
        this.configService.get<string>('FRONTEND_ORIGINS'),
      )[0],
    );
    frontendUrl.searchParams.set('integration', provider);
    frontendUrl.searchParams.set('integration_status', outcome);
    return frontendUrl.toString();
  }

  private callbackFailureOutcome(error: unknown): OAuthCallbackOutcome {
    if (error instanceof ProviderAuthorizationCodeRejectedError) {
      return 'configuration_required';
    }

    return 'token_exchange_failed';
  }
}
