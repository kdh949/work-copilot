import type { IntegrationProfile } from '../integrations/profiles/entities/integration-profile.entity';
import type { WorkBriefDraft } from '../work-briefs/entities/work-brief-draft.entity';
import type { BriefPublication } from './entities/brief-publication.entity';
import { PublicationPreviewService } from './publication-preview.service';
import { PublicationRendererService } from './publication-renderer.service';

function createService(): PublicationPreviewService {
  return new PublicationPreviewService(
    {} as never,
    {} as never,
    {} as never,
    new PublicationRendererService(),
  );
}

const draft = {
  id: 'draft-1',
  sourceJiraId: '42',
  sourceJiraKey: 'ENG-42',
  optimisticVersion: 3,
  maskedBrief: {
    childTasks: [
      {
        clientTaskId: 'task-1',
        text: '하위 작업',
        summary: '하위 작업 요약',
        evidenceIds: [],
        selected: true,
      },
    ],
  },
} as WorkBriefDraft;

const publication = {
  id: 'publication-1',
  confluenceContentId: '99',
} as BriefPublication;

function createProfile(): IntegrationProfile {
  return {
    id: 'profile-1',
    jiraBaseUrl: 'https://jira.example.test/',
    allowedProjectKeys: ['ENG'],
    policy: {
      childTaskTemplate: {
        issueTypeId: '10001',
        fields: { priority: 'high' },
      },
    },
  } as IntegrationProfile;
}

describe('PublicationPreviewService child-task preview', () => {
  it('hashes and exposes the canonical Jira issue-create payload', () => {
    const service = createService();
    const profile = createProfile();

    const preview = service.childTasks(draft, publication, profile);

    expect(preview.childTasks[0]).toMatchObject({
      clientTaskId: 'task-1',
      payload: {
        project: { key: 'ENG' },
        issueType: { id: '10001' },
        parent: { id: '42', key: 'ENG-42' },
        fields: {
          priority: 'high',
          project: { key: 'ENG' },
          issuetype: { id: '10001' },
          parent: { id: '42' },
          summary: '하위 작업 요약',
        },
      },
    });

    profile.policy.childTaskTemplate!.fields.priority = 'highest';
    const changed = service.childTasks(draft, publication, profile);

    expect(changed.configurationFingerprint).not.toBe(
      preview.configurationFingerprint,
    );
    expect(changed.previewHash).not.toBe(preview.previewHash);
  });
});
