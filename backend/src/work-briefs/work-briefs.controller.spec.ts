import 'reflect-metadata';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { HttpStatus, RequestMethod } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { WorkBriefsController } from './work-briefs.controller';

describe('WorkBriefsController', () => {
  const service = {
    createDraft: jest.fn(),
    findDraft: jest.fn(),
    updateDraft: jest.fn(),
    refreshDraft: jest.fn(),
    listDrafts: jest.fn(),
    lookupDraftsForAssignedIssues: jest.fn(),
    deleteDraft: jest.fn(),
    regenerateDraft: jest.fn(),
  };
  const readinessService = {
    assessDraft: jest.fn(),
  };
  const publicationService = {
    previewConfluence: jest.fn(),
    publish: jest.fn(),
    findLatest: jest.fn(),
    previewJira: jest.fn(),
    publishJira: jest.fn(),
    previewChildTasks: jest.fn(),
    publishChildTasks: jest.fn(),
    retry: jest.fn(),
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
      publicationService as never,
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
      publicationService as never,
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

  it('passes a bound preview, idempotency key, and explicit approval to Confluence publication', async () => {
    const controller = new WorkBriefsController(
      service as never,
      readinessService as never,
      publicationService as never,
    );
    publicationService.publish.mockResolvedValue({ status: 'PUBLISHED' });

    await controller.publish(
      'draft-id',
      'publish-key-1',
      {
        draftVersion: 3,
        approved: true,
        previewHash: 'a'.repeat(64),
      },
      { user: { sub: 7 }, correlationId: 'correlation-id' } as never,
    );

    expect(publicationService.publish).toHaveBeenCalledWith(
      7,
      'draft-id',
      {
        draftVersion: 3,
        approved: true,
        previewHash: 'a'.repeat(64),
        idempotencyKey: 'publish-key-1',
      },
      'correlation-id',
    );
  });

  it('keeps Jira and child-task write commands on their separately approved endpoints', async () => {
    const controller = new WorkBriefsController(
      service as never,
      readinessService as never,
      publicationService as never,
    );
    const request = {
      user: { sub: 7 },
      correlationId: 'correlation-id',
    } as never;
    const dto = {
      draftVersion: 3,
      approved: true,
      previewHash: 'b'.repeat(64),
    };

    await controller.previewConfluencePublication('draft-id', request);
    await controller.publishJira(
      'draft-id',
      'publication-id',
      'jira-key',
      dto,
      request,
    );
    await controller.previewChildTaskPublication(
      'draft-id',
      'publication-id',
      request,
    );
    await controller.publishChildTasks(
      'draft-id',
      'publication-id',
      'child-key',
      dto,
      request,
    );

    expect(publicationService.previewConfluence).toHaveBeenCalledWith(
      7,
      'draft-id',
      'correlation-id',
    );
    expect(publicationService.publishJira).toHaveBeenCalledWith(
      7,
      'draft-id',
      'publication-id',
      expect.objectContaining({
        previewHash: 'b'.repeat(64),
        idempotencyKey: 'jira-key',
      }),
      'correlation-id',
    );
    expect(publicationService.previewChildTasks).toHaveBeenCalledWith(
      7,
      'draft-id',
      'publication-id',
      'correlation-id',
    );
    expect(publicationService.publishChildTasks).toHaveBeenCalledWith(
      7,
      'draft-id',
      'publication-id',
      expect.objectContaining({
        previewHash: 'b'.repeat(64),
        idempotencyKey: 'child-key',
      }),
      'correlation-id',
    );
  });

  it('exposes the collection list and a 204 delete on the draft resource', () => {
    const handlers = WorkBriefsController.prototype as unknown as Record<
      string,
      object
    >;

    expect(Reflect.getMetadata(PATH_METADATA, handlers.list)).toBe(
      'brief-drafts',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handlers.list)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handlers.remove)).toBe(
      'brief-drafts/:id',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handlers.remove)).toBe(
      RequestMethod.DELETE,
    );
    // A deleted draft has no body to return, and returning one would risk
    // echoing brief content back on the way out.
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handlers.remove)).toBe(
      HttpStatus.NO_CONTENT,
    );
  });

  it('forwards list filters and the delete correlation ID', async () => {
    const controller = new WorkBriefsController(
      service as never,
      readinessService as never,
      publicationService as never,
    );
    const request = { user: { sub: 7 }, correlationId: 'correlation-id' };
    service.listDrafts.mockResolvedValue({ items: [], nextCursor: null });
    service.deleteDraft.mockResolvedValue(undefined);

    await controller.list(
      { limit: 10, status: 'draft', cursor: 'cursor' },
      request as never,
    );
    await controller.remove('draft-id', request as never);

    expect(service.listDrafts).toHaveBeenCalledWith(7, {
      limit: 10,
      status: 'draft',
      cursor: 'cursor',
    });
    expect(service.deleteDraft).toHaveBeenCalledWith(
      7,
      'draft-id',
      'correlation-id',
    );
  });

  it('uses a protected bulk lookup for the current assigned-issue rows', async () => {
    const handlers = WorkBriefsController.prototype as unknown as Record<
      string,
      object
    >;
    const controller = new WorkBriefsController(
      service as never,
      readinessService as never,
      publicationService as never,
    );
    service.lookupDraftsForAssignedIssues.mockResolvedValue({ items: [] });

    await controller.lookup({ sourceJiraKeys: ['ENG-1', 'ENG-2'] }, {
      user: { sub: 7 },
    } as never);

    expect(Reflect.getMetadata(PATH_METADATA, handlers.lookup)).toBe(
      'brief-drafts/lookup',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handlers.lookup)).toBe(
      RequestMethod.POST,
    );
    expect(service.lookupDraftsForAssignedIssues).toHaveBeenCalledWith(7, {
      sourceJiraKeys: ['ENG-1', 'ENG-2'],
    });
  });

  it('exposes regeneration as a POST on the draft with the correlation ID', async () => {
    const handlers = WorkBriefsController.prototype as unknown as Record<
      string,
      object
    >;

    expect(Reflect.getMetadata(PATH_METADATA, handlers.regenerate)).toBe(
      'brief-drafts/:id/regenerate',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handlers.regenerate)).toBe(
      RequestMethod.POST,
    );

    const controller = new WorkBriefsController(
      service as never,
      readinessService as never,
      publicationService as never,
    );
    service.regenerateDraft.mockResolvedValue({ id: 'draft-id' });

    await controller.regenerate(
      'draft-id',
      { optimisticVersion: 2, instruction: '더 간결하게 작성하세요.' },
      { user: { sub: 7 }, correlationId: 'correlation-id' } as never,
    );

    expect(service.regenerateDraft).toHaveBeenCalledWith(
      7,
      'draft-id',
      expect.objectContaining({ optimisticVersion: 2 }),
      'correlation-id',
    );
  });
});
