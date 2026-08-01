import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { WebhookIngestService } from '../src/webhooks/webhook-ingest.service';
import { WorkCopilotWebhooksController } from '../src/webhooks/work-copilot-webhooks.controller';

describe('Work Copilot webhook ingress (e2e)', () => {
  let app: INestApplication<App>;
  const ingest = {
    ingest: jest.fn().mockResolvedValue({
      outcome: 'manual_refresh_required',
      refreshRequired: true,
    }),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkCopilotWebhooksController],
      providers: [{ provide: WebhookIngestService, useValue: ingest }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('accepts the provider-shaped HTTP boundary without returning its body', async () => {
    const sourceBody = '김민수 fixture/.env';

    await request(app.getHttpServer())
      .post('/webhooks/11111111-1111-4111-8111-111111111111/jira')
      .set('x-work-copilot-webhook-secret', 'route-secret')
      .send({
        issue: {
          id: '100',
          updated: '2026-08-02T10:00:00.000Z',
          fields: { description: sourceBody },
        },
      })
      .expect(202)
      .expect({ outcome: 'manual_refresh_required', refreshRequired: true });

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: '11111111-1111-4111-8111-111111111111',
        provider: 'jira',
      }),
    );
  });
});
