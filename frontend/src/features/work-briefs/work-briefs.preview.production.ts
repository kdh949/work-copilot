import type {
  BriefDraft,
  WorkBriefApiRequest,
  WorkEvidence,
} from './work-briefs.types';

// This module replaces local design fixtures in production builds. App.tsx
// references the values only when import.meta.env.DEV is true, but exporting
// safe placeholders also prevents accidental fixture disclosure by bundlers.
export const WORK_BRIEF_PREVIEW_USER = {
  id: 0,
  email: 'preview@example.invalid',
  nickname: '미리보기',
  department: '미리보기',
  employeeNumber: '미리보기 전용',
  role: 'member',
};

export const WORK_BRIEF_PREVIEW_ISSUE = '미리보기 전용';

export const WORK_BRIEF_PREVIEW_EVIDENCE: WorkEvidence[] = [];

const productionPreviewDraft: BriefDraft = {
  id: 'production-preview-disabled',
  sourceJiraKey: WORK_BRIEF_PREVIEW_ISSUE,
  sourceJiraVersion: '0',
  content: {
    title: { text: '미리보기는 개발 환경에서만 사용할 수 있습니다.', evidenceIds: [] },
    summary: { text: '', evidenceIds: [] },
    requirements: [],
    acceptanceCriteria: [],
    risks: [],
    nextSteps: [],
    childTasks: [],
  },
  evidence: [],
  status: 'draft',
  freshnessStatus: 'current',
  optimisticVersion: 0,
  blockers: [],
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export const previewWorkBriefRequest: WorkBriefApiRequest = async <T>(
  path: string,
) =>
  (path === '/brief-drafts' || path.startsWith('/brief-drafts?')
    ? { items: [], nextCursor: null }
    : productionPreviewDraft) as T;
