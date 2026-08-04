/*
 * This is deliberately opt-in. It performs writes against a dedicated Data
 * Center staging tenant using a user-context OAuth2 token, then cleans them up.
 * See docs/atlassian-dc-oauth-contract.md.
 */
type ContractConfig = {
  jiraBaseUrl: string;
  confluenceBaseUrl: string;
  jiraToken: string;
  confluenceToken: string;
  confluenceParentPageId: string;
  jiraIssueId: string;
  jiraIssueKey: string;
  jiraProjectKey: string;
  jiraSubtaskIssueTypeId: string;
  jiraVersion: string;
  confluenceVersion: string;
  extraCreateFields: Record<string, unknown>;
};

type Observation = {
  endpoint: string;
  status: number;
  bodyKeys: string[];
};

const runContract =
  process.env.RUN_ATLASSIAN_DC_OAUTH_CONTRACT_TESTS === 'true';
const contractDescribe = runContract ? describe : describe.skip;

contractDescribe('Atlassian Data Center OAuth2 publication contract', () => {
  const observations: Observation[] = [];
  let config: ContractConfig | null = null;
  let confluencePageId: string | null = null;
  let remoteLinkId: string | null = null;
  let commentId: string | null = null;
  let childIssueId: string | null = null;

  beforeAll(() => {
    config = {
      jiraBaseUrl: required('ATLASSIAN_CONTRACT_JIRA_BASE_URL'),
      confluenceBaseUrl: required('ATLASSIAN_CONTRACT_CONFLUENCE_BASE_URL'),
      jiraToken: required('ATLASSIAN_CONTRACT_JIRA_TOKEN'),
      confluenceToken: required('ATLASSIAN_CONTRACT_CONFLUENCE_TOKEN'),
      confluenceParentPageId: required(
        'ATLASSIAN_CONTRACT_CONFLUENCE_PARENT_PAGE_ID',
      ),
      jiraIssueId: required('ATLASSIAN_CONTRACT_JIRA_ISSUE_ID'),
      jiraIssueKey: required('ATLASSIAN_CONTRACT_JIRA_ISSUE_KEY'),
      jiraProjectKey: required('ATLASSIAN_CONTRACT_JIRA_PROJECT_KEY'),
      jiraSubtaskIssueTypeId: required(
        'ATLASSIAN_CONTRACT_JIRA_SUBTASK_ISSUE_TYPE_ID',
      ),
      jiraVersion: required('ATLASSIAN_CONTRACT_JIRA_VERSION'),
      confluenceVersion: required('ATLASSIAN_CONTRACT_CONFLUENCE_VERSION'),
      extraCreateFields: jsonObject(
        process.env.ATLASSIAN_CONTRACT_JIRA_CREATE_FIELDS_JSON,
      ),
    };
  });

  afterAll(async () => {
    if (!config) {
      return;
    }
    const cleanup = [
      childIssueId
        ? request(
            config.jiraBaseUrl,
            config.jiraToken,
            `rest/api/2/issue/${encodeURIComponent(childIssueId)}`,
            {
              method: 'DELETE',
            },
          )
        : null,
      commentId
        ? request(
            config.jiraBaseUrl,
            config.jiraToken,
            `rest/api/2/issue/${encodeURIComponent(config.jiraIssueId)}/comment/${encodeURIComponent(commentId)}`,
            { method: 'DELETE' },
          )
        : null,
      remoteLinkId
        ? request(
            config.jiraBaseUrl,
            config.jiraToken,
            `rest/api/2/issue/${encodeURIComponent(config.jiraIssueId)}/remotelink/${encodeURIComponent(remoteLinkId)}`,
            { method: 'DELETE' },
          )
        : null,
      confluencePageId
        ? request(
            config.confluenceBaseUrl,
            config.confluenceToken,
            `rest/api/content/${encodeURIComponent(confluencePageId)}`,
            { method: 'DELETE' },
          )
        : null,
    ].filter((value): value is Promise<ContractResponse> => value !== null);
    const responses = await Promise.all(cleanup);
    for (const response of responses) {
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
    }
    // Keep a non-sensitive audit record in CI/test logs: no token or body is
    // emitted, only target versions, endpoint labels, statuses, and shape.
    console.info(
      JSON.stringify({
        jiraVersion: config.jiraVersion,
        confluenceVersion: config.confluenceVersion,
        observations,
      }),
    );
  });

  it('supports the exact OAuth2 endpoints used by publication', async () => {
    const runId = `wc-contract-${Date.now()}`;
    const current = config as ContractConfig;
    const parent = await request(
      current.confluenceBaseUrl,
      current.confluenceToken,
      `rest/api/content/${encodeURIComponent(current.confluenceParentPageId)}?expand=space,version`,
    );
    expectSuccess(parent, 'confluence parent read');
    const parentBody = record(parent.body);
    const space = parentBody ? record(parentBody.space) : null;
    const spaceKey = space && typeof space.key === 'string' ? space.key : null;
    expect(spaceKey).toBeTruthy();

    const page = await request(
      current.confluenceBaseUrl,
      current.confluenceToken,
      'rest/api/content',
      {
        method: 'POST',
        body: {
          type: 'page',
          title: `[${runId}] OAuth2 publication contract`,
          space: { key: spaceKey },
          ancestors: [{ id: current.confluenceParentPageId }],
          body: {
            storage: {
              value: '<p>OAuth2 contract test; this page is cleaned up.</p>',
              representation: 'storage',
            },
          },
        },
      },
    );
    expectSuccess(page, 'confluence page create');
    confluencePageId = identifier(record(page.body)?.id);
    expect(confluencePageId).toBeTruthy();

    const createdPage = await request(
      current.confluenceBaseUrl,
      current.confluenceToken,
      `rest/api/content/${encodeURIComponent(confluencePageId as string)}?expand=version`,
    );
    expectSuccess(createdPage, 'confluence page read');
    const children = await request(
      current.confluenceBaseUrl,
      current.confluenceToken,
      `rest/api/content/${encodeURIComponent(current.confluenceParentPageId)}/child/page?limit=1&start=0`,
    );
    expectSuccess(children, 'confluence child page pagination');
    expect(Array.isArray(record(children.body)?.results)).toBe(true);

    const remoteLink = await request(
      current.jiraBaseUrl,
      current.jiraToken,
      `rest/api/2/issue/${encodeURIComponent(current.jiraIssueId)}/remotelink`,
      {
        method: 'POST',
        body: {
          globalId: `work-copilot-contract:${runId}`,
          application: { type: 'com.dh.work-copilot', name: 'Work Copilot' },
          relationship: 'documents',
          object: {
            url: `${current.confluenceBaseUrl.replace(/\/$/, '')}/pages/viewpage.action?pageId=${confluencePageId}`,
            title: 'OAuth2 publication contract',
          },
        },
      },
    );
    expectSuccess(remoteLink, 'jira remote link create');
    remoteLinkId = identifier(record(remoteLink.body)?.id);
    expect(remoteLinkId).toBeTruthy();

    const remoteLinkRead = await request(
      current.jiraBaseUrl,
      current.jiraToken,
      `rest/api/2/issue/${encodeURIComponent(current.jiraIssueId)}/remotelink?globalId=${encodeURIComponent(`work-copilot-contract:${runId}`)}`,
    );
    expectSuccess(remoteLinkRead, 'jira remote link read');

    const commentMarker = `[work-copilot-contract:${runId}]`;
    const comment = await request(
      current.jiraBaseUrl,
      current.jiraToken,
      `rest/api/2/issue/${encodeURIComponent(current.jiraIssueId)}/comment`,
      { method: 'POST', body: { body: `${commentMarker} cleanup expected` } },
    );
    expectSuccess(comment, 'jira comment create');
    commentId = identifier(record(comment.body)?.id);
    expect(commentId).toBeTruthy();

    const comments = await request(
      current.jiraBaseUrl,
      current.jiraToken,
      `rest/api/2/issue/${encodeURIComponent(current.jiraIssueId)}/comment?maxResults=1&startAt=0`,
    );
    expectSuccess(comments, 'jira comment pagination');
    expect(Array.isArray(record(comments.body)?.comments)).toBe(true);

    const createMeta = await request(
      current.jiraBaseUrl,
      current.jiraToken,
      `rest/api/2/issue/createmeta?projectKeys=${encodeURIComponent(current.jiraProjectKey)}&issuetypeIds=${encodeURIComponent(current.jiraSubtaskIssueTypeId)}&expand=projects.issuetypes.fields`,
    );
    expectSuccess(createMeta, 'jira createmeta');

    const child = await request(
      current.jiraBaseUrl,
      current.jiraToken,
      'rest/api/2/issue',
      {
        method: 'POST',
        body: {
          fields: {
            ...current.extraCreateFields,
            project: { key: current.jiraProjectKey },
            issuetype: { id: current.jiraSubtaskIssueTypeId },
            parent: { id: current.jiraIssueId },
            summary: `OAuth2 contract ${runId}`,
          },
          properties: [
            {
              key: 'work-copilot.publication-task',
              value: { operationId: runId, clientTaskId: 'contract-task' },
            },
          ],
        },
      },
    );
    expectSuccess(child, 'jira issue create with properties');
    childIssueId = identifier(record(child.body)?.id);
    expect(childIssueId).toBeTruthy();

    const property = await request(
      current.jiraBaseUrl,
      current.jiraToken,
      `rest/api/2/issue/${encodeURIComponent(childIssueId as string)}/properties/work-copilot.publication-task`,
    );
    expectSuccess(property, 'jira issue property read');
    expect(record(record(property.body)?.value)).toMatchObject({
      operationId: runId,
      clientTaskId: 'contract-task',
    });

    const search = await request(
      current.jiraBaseUrl,
      current.jiraToken,
      `rest/api/2/search?jql=${encodeURIComponent(`parent = ${current.jiraIssueKey}`)}&fields=summary&properties=work-copilot.publication-task&maxResults=1&startAt=0`,
    );
    expectSuccess(search, 'jira search pagination');
    expect(Array.isArray(record(search.body)?.issues)).toBe(true);
  });

  async function request(
    baseUrl: string,
    token: string,
    path: string,
    init: { method?: string; body?: object } = {},
  ): Promise<ContractResponse> {
    const response = await fetch(new URL(path, ensureTrailingSlash(baseUrl)), {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      redirect: 'error',
    });
    const text = await response.text();
    const body = text ? safelyParseJson(text) : null;
    observations.push({
      endpoint: `${init.method ?? 'GET'} ${path.split('?')[0]}`,
      status: response.status,
      bodyKeys: Object.keys(record(body) ?? {}).sort(),
    });
    return { status: response.status, body };
  }
});

type ContractResponse = { status: number; body: unknown };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when contract tests are enabled.`);
  }
  return value;
}

function jsonObject(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) {
    return {};
  }
  const parsed: unknown = JSON.parse(value);
  const object = record(parsed);
  if (!object) {
    throw new Error(
      'ATLASSIAN_CONTRACT_JIRA_CREATE_FIELDS_JSON must be an object.',
    );
  }
  return object;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function safelyParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function expectSuccess(response: ContractResponse, endpoint: string): void {
  expect(response.status, endpoint).toBeGreaterThanOrEqual(200);
  expect(response.status, endpoint).toBeLessThan(300);
  expect(record(response.body), endpoint).not.toBeNull();
}
