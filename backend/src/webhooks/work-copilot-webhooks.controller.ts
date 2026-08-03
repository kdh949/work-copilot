import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CorrelatedRequest } from '../common/http/correlation-id.middleware';
import { WebhookIngestService } from './webhook-ingest.service';

@Controller('webhooks')
export class WorkCopilotWebhooksController {
  constructor(private readonly webhookIngest: WebhookIngestService) {}

  @Post(':profileId/:provider')
  @HttpCode(HttpStatus.ACCEPTED)
  ingest(
    @Param('profileId') profileId: string,
    @Param('provider') provider: string,
    @Headers('x-work-copilot-webhook-secret') routeSecret: string | undefined,
    @Body() payload: unknown,
    @Req() request: Request & CorrelatedRequest,
  ) {
    return this.webhookIngest.ingest({
      profileId,
      provider,
      payload,
      routeSecret,
      remoteAddress: request.ip,
      correlationId: request.correlationId ?? 'missing-correlation-id',
    });
  }
}
