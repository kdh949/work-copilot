import { AtlassianPublicationWriteGateway } from './atlassian-publication-write.gateway';
import { confluencePublicationTitle } from './confluence-publication-title';
import { PublicationRendererService } from './publication-renderer.service';

const PROFILE = {
  id: 'ac2f4d2e-078e-4e51-b257-3a6b0c2e7444',
  jiraBaseUrl: 'https://jira.example.test/',
  confluenceBaseUrl: 'https://confluence.example.test/',
  allowedProjectKeys: ['ENG'],
  allowedSpaceKeys: ['ENG'],
} as never;

function createGateway(readResponses: unknown[], writeResponses: unknown[]) {
  const oauth = { getAccessToken: jest.fn().mockResolvedValue('user-token') };
  const accessPolicy = {
    providerUrl: jest.fn(
      (_profile: unknown, provider: string, path: string) =>
        new URL(`https://${provider}.example.test/${path}`),
    ),
    providerBaseUrl: jest.fn(
      (_profile: unknown, provider: string) =>
        `https://${provider}.example.test/`,
    ),
    assertAllowedSpace: jest.fn(),
    assertAllowedProject: jest.fn(),
  };
  const readClient = {
    getJson: jest.fn(() => Promise.resolve(readResponses.shift())),
  };
  const writeClient = {
    postJsonExpectObject: jest.fn(() => Promise.resolve(writeResponses.shift())),
    postJsonAllowEmpty: jest.fn(() => Promise.resolve(writeResponses.shift())),
    putJsonExpectObject: jest.fn(() => Promise.resolve(writeResponses.shift())),
    putJsonAllowEmpty: jest.fn(() => Promise.resolve(writeResponses.shift())),
  };
  const gateway = new AtlassianPublicationWriteGateway(
    oauth as never,
    accessPolicy as never,
    readClient as never,
    writeClient as never,
    new PublicationRendererService(),
  );
  return { gateway, oauth, accessPolicy, readClient, writeClient };
}

describe('AtlassianPublicationWriteGateway', () => {
  const input = {
    userId: 7,
    correlationId: 'correlation-1',
    profile: PROFILE,
    operationId: '62e1a2e6-af0e-41fb-a2f0-93c823be0b5c',
    parentPageId: '55',
    existingContentId: null,
    draftId: '4e5a9799-96cc-4e76-9dde-57cf1b5d5eb8',
    sourceJiraKey: 'ENG-42',
    content: {
      title: { text: '배포 브리프', evidenceIds: ['jira:42'] },
      summary: { text: '준비를 확인합니다.', evidenceIds: ['jira:42'] },
      requirements: [],
      acceptanceCriteria: [],
      risks: [],
      nextSteps: [],
      childTasks: [],
    },
    evidence: [
      {
        id: 'jira:42',
        provider: 'jira',
        sourceId: '42',
        url: 'https://jira.example.test/browse/ENG-42',
        title: '배포 이슈',
        version: '2026-08-04T00:00:00.000Z',
        excerptLength: 1,
        accessStatus: 'accessible',
        dlpStatus: 'not_evaluated',
        aiStatus: 'included',
      },
    ],
  };

  function expectedConfluenceTitle(): string {
    const rendered = new PublicationRendererService().render(
      input.sourceJiraKey,
      input.content,
      input.evidence,
    );
    return confluencePublicationTitle(
      rendered.pageTitle,
      input.draftId,
      rendered.contentHash,
    );
  }

  it('creates a Confluence page under the verified parent with a stable title marker', async () => {
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: { id: '55', space: { key: 'ENG' }, version: { number: 4 } },
        },
        { status: 'ok', body: { results: [] } },
      ],
      [{ status: 'ok', body: { id: '99', version: { number: 1 } } }],
    );

    const result = await harness.gateway.upsertConfluenceBrief(input);

    expect(result).toMatchObject({
      providerObjectId: '99',
      providerObjectVersion: '1',
      providerUrl:
        'https://confluence.example.test/pages/viewpage.action?pageId=99',
    });
    expect(harness.oauth.getAccessToken).toHaveBeenCalledWith(
      7,
      'confluence',
      'correlation-1',
      { requiredScopes: ['WRITE'] },
    );
    expect(harness.accessPolicy.assertAllowedSpace).toHaveBeenCalledWith(
      PROFILE,
      'ENG',
    );
    expect(harness.writeClient.postJsonExpectObject).toHaveBeenNthCalledWith(
      1,
      expect.any(URL),
      'https://confluence.example.test/',
      'user-token',
      expect.objectContaining({
        ancestors: [{ id: '55' }],
        space: { key: 'ENG' },
        title: expectedConfluenceTitle(),
      }),
    );
    expect(harness.writeClient.postJsonExpectObject).toHaveBeenCalledTimes(1);
  });

  it('reuses a page carrying the same deterministic title without another write', async () => {
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: { id: '55', space: { key: 'ENG' }, version: { number: 4 } },
        },
        {
          status: 'ok',
          body: {
            results: [
              {
                id: '99',
                title: expectedConfluenceTitle(),
                version: { number: 1 },
              },
            ],
          },
        },
      ],
      [],
    );

    await expect(
      harness.gateway.upsertConfluenceBrief(input),
    ).resolves.toMatchObject({
      providerObjectId: '99',
    });
    expect(harness.writeClient.postJsonExpectObject).not.toHaveBeenCalled();
  });

  it('reconciles a page after an ambiguous create response without a property write', async () => {
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: { id: '55', space: { key: 'ENG' }, version: { number: 4 } },
        },
        { status: 'ok', body: { results: [] } },
        {
          status: 'ok',
          body: {
            results: [
              {
                id: '99',
                title: expectedConfluenceTitle(),
                version: { number: 1 },
              },
            ],
          },
        },
      ],
      [{ status: 'rejected', body: {} }],
    );

    await expect(
      harness.gateway.upsertConfluenceBrief(input),
    ).resolves.toMatchObject({ providerObjectId: '99' });
    expect(harness.writeClient.postJsonExpectObject).toHaveBeenCalledTimes(1);
    expect(harness.writeClient.putJsonExpectObject).not.toHaveBeenCalled();
  });

  it('reconciles a 201 empty Confluence create response before accepting success', async () => {
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: { id: '55', space: { key: 'ENG' }, version: { number: 4 } },
        },
        { status: 'ok', body: { results: [] } },
        {
          status: 'ok',
          body: {
            results: [
              { id: '99', title: expectedConfluenceTitle(), version: { number: 1 } },
            ],
          },
        },
      ],
      [{ status: 'ok_empty' }],
    );

    await expect(
      harness.gateway.upsertConfluenceBrief(input),
    ).resolves.toMatchObject({ providerObjectId: '99' });
    expect(harness.writeClient.postJsonExpectObject).toHaveBeenCalledTimes(1);
  });

  it('does not send another create when an empty response cannot be reconciled', async () => {
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: { id: '55', space: { key: 'ENG' }, version: { number: 4 } },
        },
        { status: 'ok', body: { results: [] } },
        { status: 'ok', body: { results: [] } },
      ],
      [{ status: 'ok_empty' }],
    );

    await expect(harness.gateway.upsertConfluenceBrief(input)).rejects.toThrow(
      'PUBLICATION_RECONCILIATION_INDETERMINATE',
    );
    expect(harness.writeClient.postJsonExpectObject).toHaveBeenCalledTimes(1);
  });

  it('does not create when the Confluence listing is access limited', async () => {
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: { id: '55', space: { key: 'ENG' }, version: { number: 4 } },
        },
        { status: 'access_limited' },
      ],
      [],
    );

    await expect(harness.gateway.upsertConfluenceBrief(input)).rejects.toThrow(
      'PUBLICATION_RECONCILIATION_INDETERMINATE',
    );
    expect(harness.writeClient.postJsonExpectObject).not.toHaveBeenCalled();
  });

  it('does not create when the marker is beyond the reconciliation page budget', async () => {
    const pages = Array.from({ length: 5 }, () => ({
      status: 'ok',
      body: {
        results: Array.from({ length: 50 }, (_, index) => ({
          id: `unrelated-${index}`,
          title: 'different title',
          version: { number: 1 },
        })),
        total: 300,
      },
    }));
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: { id: '55', space: { key: 'ENG' }, version: { number: 4 } },
        },
        ...pages,
      ],
      [],
    );

    await expect(harness.gateway.upsertConfluenceBrief(input)).rejects.toThrow(
      'PUBLICATION_RECONCILIATION_INDETERMINATE',
    );
    expect(harness.writeClient.postJsonExpectObject).not.toHaveBeenCalled();
  });

  it('finds a Confluence title marker on a later child-page page', async () => {
    const unrelated = Array.from({ length: 50 }, (_, index) => ({
      id: `unrelated-${index}`,
      title: '다른 제목',
      version: { number: 1 },
    }));
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: { id: '55', space: { key: 'ENG' }, version: { number: 4 } },
        },
        { status: 'ok', body: { results: unrelated, total: 51 } },
        {
          status: 'ok',
          body: {
            results: [
              {
                id: '99',
                title: expectedConfluenceTitle(),
                version: { number: 1 },
              },
            ],
            total: 51,
          },
        },
      ],
      [],
    );

    await expect(
      harness.gateway.upsertConfluenceBrief(input),
    ).resolves.toMatchObject({ providerObjectId: '99' });
    expect(harness.readClient.getJson).toHaveBeenCalledTimes(3);
    expect(harness.writeClient.postJsonExpectObject).not.toHaveBeenCalled();
  });

  it('finds a summary comment marker on a later result page', async () => {
    const marker = `[work-copilot-operation:${input.operationId}]`;
    const unrelated = Array.from({ length: 50 }, (_, index) => ({
      id: `comment-${index}`,
      body: '다른 댓글',
    }));
    const harness = createGateway(
      [
        { status: 'ok', body: { comments: unrelated, total: 51 } },
        {
          status: 'ok',
          body: {
            comments: [{ id: 'comment-99', body: `요약\n${marker}` }],
            total: 51,
          },
        },
      ],
      [],
    );

    await expect(
      harness.gateway.createJiraSummaryComment({
        userId: 7,
        correlationId: 'correlation-1',
        profile: PROFILE,
        operationId: input.operationId,
        sourceJiraId: '42',
        summary: '요약',
        confluenceContentId: '99',
        confluenceUrl: 'https://confluence.example.test/pages/99',
      }),
    ).resolves.toEqual({ providerObjectId: 'comment-99' });
    expect(harness.readClient.getJson).toHaveBeenCalledTimes(2);
    expect(harness.writeClient.postJsonExpectObject).not.toHaveBeenCalled();
  });

  it('creates the child-task operation marker atomically in issue creation', async () => {
    const harness = createGateway(
      [{ status: 'ok', body: { issues: [] } }],
      [{ status: 'ok', body: { id: 'child-99' } }],
    );

    const result = await harness.gateway.createJiraChildTask({
      userId: 7,
      correlationId: 'correlation-1',
      profile: PROFILE,
      operationId: input.operationId,
      sourceJiraId: '42',
      sourceJiraKey: 'ENG-42',
      childTask: {
        clientTaskId: 'child-task-1',
        text: '하위 작업',
        summary: '하위 작업 요약',
        evidenceIds: [],
        selected: true,
      },
      template: {
        issueTypeId: '10001',
        fields: { priority: 'high' },
      },
    });

    expect(result).toEqual({ providerObjectId: 'child-99' });
    expect(harness.writeClient.postJsonExpectObject).toHaveBeenCalledWith(
      expect.any(URL),
      'https://jira.example.test/',
      'user-token',
      expect.objectContaining({
        fields: expect.objectContaining({
          project: { key: 'ENG' },
          issuetype: { id: '10001' },
          parent: { id: '42' },
        }),
        properties: [
          {
            key: 'work-copilot.publication-task',
            value: {
              operationId: input.operationId,
              clientTaskId: 'child-task-1',
            },
          },
        ],
      }),
    );
    expect(harness.writeClient.putJsonExpectObject).not.toHaveBeenCalled();
  });

  it('collects child-task markers for a phase in one paginated reconciliation', async () => {
    const harness = createGateway(
      [
        {
          status: 'ok',
          body: {
            issues: [
              {
                id: 'child-1',
                properties: {
                  'work-copilot.publication-task': {
                    value: {
                      operationId: input.operationId,
                      clientTaskId: 'child-task-1',
                    },
                  },
                },
              },
            ],
            total: 2,
          },
        },
        {
          status: 'ok',
          body: {
            issues: [
              {
                id: 'child-2',
                properties: {
                  'work-copilot.publication-task': {
                    value: {
                      operationId: input.operationId,
                      clientTaskId: 'child-task-2',
                    },
                  },
                },
              },
            ],
            total: 2,
          },
        },
      ],
      [],
    );

    const result = await harness.gateway.reconcileJiraChildTasks({
      userId: 7,
      correlationId: 'correlation-1',
      profile: PROFILE,
      operationId: input.operationId,
      sourceJiraKey: 'ENG-42',
      clientTaskIds: ['child-task-1', 'child-task-2'],
    });

    expect(result).toMatchObject({ status: 'found' });
    if (result.status === 'found') {
      expect(result.value.get('child-task-1')?.issueId).toBe('child-1');
      expect(result.value.get('child-task-2')?.issueId).toBe('child-2');
    }
    expect(harness.readClient.getJson).toHaveBeenCalledTimes(2);
    expect(harness.writeClient.postJsonExpectObject).not.toHaveBeenCalled();
  });

  it('reconciles an ambiguous child-task create through its atomic marker', async () => {
    const harness = createGateway(
      [
        { status: 'ok', body: { issues: [] } },
        { status: 'ok', body: { issues: [{ id: 'child-99' }] } },
        {
          status: 'ok',
          body: {
            value: {
              operationId: input.operationId,
              clientTaskId: 'child-task-1',
            },
          },
        },
      ],
      [{ status: 'rejected', body: {} }],
    );

    await expect(
      harness.gateway.createJiraChildTask({
        userId: 7,
        correlationId: 'correlation-1',
        profile: PROFILE,
        operationId: input.operationId,
        sourceJiraId: '42',
        sourceJiraKey: 'ENG-42',
        childTask: {
          clientTaskId: 'child-task-1',
          text: '하위 작업',
          summary: '하위 작업 요약',
          evidenceIds: [],
          selected: true,
        },
        template: { issueTypeId: '10001', fields: {} },
      }),
    ).resolves.toEqual({ providerObjectId: 'child-99' });
    expect(harness.writeClient.postJsonExpectObject).toHaveBeenCalledTimes(1);
  });

  it('finds a child-task marker on the second Jira search page without property N+1', async () => {
    const unrelated = Array.from({ length: 50 }, (_, index) => ({
      id: `child-${index}`,
      properties: {
        'work-copilot.publication-task': {
          value: { operationId: 'other-operation', clientTaskId: 'other-task' },
        },
      },
    }));
    const harness = createGateway(
      [
        { status: 'ok', body: { issues: unrelated, total: 51 } },
        {
          status: 'ok',
          body: {
            issues: [
              {
                id: 'child-99',
                properties: {
                  'work-copilot.publication-task': {
                    value: {
                      operationId: input.operationId,
                      clientTaskId: 'child-task-1',
                    },
                  },
                },
              },
            ],
            total: 51,
          },
        },
      ],
      [],
    );

    await expect(
      harness.gateway.createJiraChildTask({
        userId: 7,
        correlationId: 'correlation-1',
        profile: PROFILE,
        operationId: input.operationId,
        sourceJiraId: '42',
        sourceJiraKey: 'ENG-42',
        childTask: {
          clientTaskId: 'child-task-1',
          text: '하위 작업',
          summary: '하위 작업 요약',
          evidenceIds: [],
          selected: true,
        },
        template: { issueTypeId: '10001', fields: {} },
      }),
    ).resolves.toEqual({ providerObjectId: 'child-99' });
    expect(harness.readClient.getJson).toHaveBeenCalledTimes(2);
    expect(harness.writeClient.putJsonExpectObject).not.toHaveBeenCalled();
    expect(harness.writeClient.postJsonExpectObject).not.toHaveBeenCalled();
  });
});
