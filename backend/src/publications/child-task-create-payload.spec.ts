import {
  buildChildTaskCreatePayload,
  projectKeyFromIssueKey,
} from './child-task-create-payload';

describe('child task create payload', () => {
  const input = {
    sourceJiraId: '100',
    sourceJiraKey: 'eng-42',
    childTask: {
      clientTaskId: 'task-1',
      text: '작업',
      summary: '줄바꿈\n요약',
      evidenceIds: [],
      selected: true,
    },
    template: {
      issueTypeId: '10001',
      fields: { priority: 'high' },
    },
  };

  it('builds the exact issue-create fields used by Jira', () => {
    expect(buildChildTaskCreatePayload(input)).toEqual({
      project: { key: 'ENG' },
      issueType: { id: '10001' },
      parent: { id: '100', key: 'eng-42' },
      fields: {
        priority: 'high',
        project: { key: 'ENG' },
        issuetype: { id: '10001' },
        parent: { id: '100' },
        summary: '줄바꿈 요약',
      },
    });
  });

  it('rejects malformed parent issue keys', () => {
    expect(projectKeyFromIssueKey('not-a-jira-key')).toBeNull();
  });
});
