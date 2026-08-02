import { WebhookIngressBoundaryService } from './webhook-ingress-boundary.service';

const configFor = (values: Record<string, string | undefined>) => ({
  get: jest.fn((key: string) => values[key]),
});

describe('WebhookIngressBoundaryService', () => {
  it('uses manual refresh until an administrator verifies shadow ingress and a CIDR allowlist', () => {
    const service = new WebhookIngressBoundaryService(
      configFor({
        WEBHOOK_SHADOW_MODE: 'true',
        WEBHOOK_INGRESS_ALLOWED_CIDRS: '127.0.0.1/32',
      }) as never,
    );

    expect(service.status()).toEqual({
      mode: 'manual_refresh',
      ingressVerified: false,
      allowedCidrCount: 1,
    });
    expect(
      service.authenticate(
        '127.0.0.1',
        'rotating-route-secret',
        'rotating-route-secret',
      ),
    ).toEqual({ kind: 'manual_refresh' });
  });

  it('requires both a trusted peer address and a constant-time route secret match in shadow mode', () => {
    const service = new WebhookIngressBoundaryService(
      configFor({
        WEBHOOK_SHADOW_MODE: 'true',
        WEBHOOK_INGRESS_VERIFIED: 'true',
        WEBHOOK_INGRESS_ALLOWED_CIDRS: '127.0.0.1/32,10.20.0.0/16',
      }) as never,
    );

    expect(
      service.authenticate(
        '::ffff:127.0.0.1',
        'rotating-route-secret',
        'rotating-route-secret',
      ),
    ).toEqual({ kind: 'accepted' });
    expect(
      service.authenticate(
        '10.21.0.2',
        'rotating-route-secret',
        'rotating-route-secret',
      ),
    ).toEqual({ kind: 'rejected', code: 'INGRESS_ADDRESS_REJECTED' });
    expect(
      service.authenticate(
        '10.20.1.2',
        'wrong-route-secret',
        'rotating-route-secret',
      ),
    ).toEqual({ kind: 'rejected', code: 'ROUTE_SECRET_REJECTED' });
  });

  it('treats malformed CIDR configuration as unverified instead of accepting an ingress', () => {
    const service = new WebhookIngressBoundaryService(
      configFor({
        WEBHOOK_SHADOW_MODE: 'true',
        WEBHOOK_INGRESS_VERIFIED: 'true',
        WEBHOOK_INGRESS_ALLOWED_CIDRS: 'not-a-cidr',
      }) as never,
    );

    expect(service.status().mode).toBe('manual_refresh');
  });
});
