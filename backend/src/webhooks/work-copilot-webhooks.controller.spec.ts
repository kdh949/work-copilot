import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { WorkCopilotWebhooksController } from './work-copilot-webhooks.controller';

describe('WorkCopilotWebhooksController', () => {
  it('exposes an unauthenticated but dedicated 202 webhook route with no provider-write dependency', async () => {
    const ingest = { ingest: jest.fn().mockResolvedValue({}) };
    const controller = new WorkCopilotWebhooksController(ingest as never);
    const payload = { issue: { id: '100', updated: '2026-08-02T00:00:00Z' } };

    await controller.ingest(
      '11111111-1111-4111-8111-111111111111',
      'jira',
      'route-secret',
      payload,
      {
        ip: '198.51.100.24',
        socket: { remoteAddress: '127.0.0.1' },
        correlationId: 'webhook-correlation-1',
      } as never,
    );

    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        payload,
        routeSecret: 'route-secret',
        remoteAddress: '198.51.100.24',
      }),
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, WorkCopilotWebhooksController),
    ).toBe('webhooks');
  });
});
