import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { WorkBriefsController } from './work-briefs.controller';

describe('WorkBriefsController', () => {
  const service = {
    createDraft: jest.fn(),
    findDraft: jest.fn(),
    updateDraft: jest.fn(),
    refreshDraft: jest.fn(),
  };
  const readinessService = {
    assessDraft: jest.fn(),
  };

  it('uses the protected brief-drafts API surface', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      WorkBriefsController,
    ) as unknown[];

    expect(guards).toContain(SessionAuthGuard);
    expect(Reflect.getMetadata(PATH_METADATA, WorkBriefsController)).toBe('/');
  });

  it('passes the session user and correlation ID without provider write adapters', async () => {
    const controller = new WorkBriefsController(
      service as never,
      readinessService as never,
    );
    const request = {
      user: { sub: 7 },
      correlationId: 'correlation-id',
    };
    service.createDraft.mockResolvedValue({ id: 'draft-id' });

    await controller.create(
      {
        sourceJiraKey: 'DEMO-1',
        selectedEvidenceIds: ['jira:100'],
        instruction: '작성하세요.',
      },
      request as never,
    );

    expect(service.createDraft).toHaveBeenCalledWith(
      7,
      expect.any(Object),
      'correlation-id',
    );
  });

  it('runs a protected, read-only readiness assessment for the draft owner', async () => {
    const controller = new WorkBriefsController(
      service as never,
      readinessService as never,
    );
    readinessService.assessDraft.mockResolvedValue({ status: 'READY' });

    await controller.readiness('draft-id', {
      user: { sub: 7 },
      correlationId: 'correlation-id',
    } as never);

    expect(readinessService.assessDraft).toHaveBeenCalledWith(
      7,
      'draft-id',
      'correlation-id',
    );
  });
});
