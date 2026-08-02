export type ReadinessStatus =
  'READY' | 'NEEDS_ATTENTION' | 'BLOCKED' | 'ACCESS_LIMITED';

export type ReadinessFindingCode =
  | 'COVERAGE_MISSING'
  | 'CREATE_FIELD_MISSING'
  | 'CREATE_METADATA_ACCESS_LIMITED'
  | 'CREATE_METADATA_UNAVAILABLE'
  | 'UNRESOLVED_BLOCKER'
  | 'ACCESS_LIMITED_DEPENDENCY'
  | 'FRESHNESS_REVIEW_REQUIRED'
  | 'ACCESS_CHANGED'
  | 'PROFILE_CHANGED';

export type ReadinessFindingSeverity = 'blocking' | 'warning';

export type ReadinessFinding = {
  code: ReadinessFindingCode;
  severity: ReadinessFindingSeverity;
  requirementIndex?: number;
  missing?: Array<'child_task' | 'verification_evidence'>;
  fieldId?: string;
  evidenceIds?: string[];
};

export type ReadinessBlocker =
  | {
      kind: 'visible_blocker';
      issueKey: string;
      url: string;
      crossProject: boolean;
    }
  | { kind: 'access_limited' };

export type ReadinessAssessmentView = {
  draftId: string;
  assessmentVersion: number;
  status: ReadinessStatus;
  publishAllowed: boolean;
  findings: ReadinessFinding[];
  blockers: ReadinessBlocker[];
  evaluatedAt: Date;
};
