# Work Copilot 실무 사용성 개선 — 2·3단계 실행 계획

1단계(화면이 거짓말하지 않게 만들기)는 완료되었다. 이 문서는 그다음, **매일 쓸 수 있게** 만드는
작업의 실행 계획이다. 2단계와 3단계는 착수 가능한 수준으로, 4·5단계는 방향과 전제조건만 남긴다.

## 0. 이 문서의 확정값

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 초안 삭제 의미 | **소프트 삭제** (`deletedAt`) + `WHERE "deletedAt" IS NULL` 부분 unique 인덱스 | 게시 이력·감사 추적을 남기면서 이슈 점유만 해제한다 |
| 라우팅 | **react-router 앱 전면 도입**. `menu` state를 URL로 승격 | 메뉴 state와 URL이 두 개의 진실 소스로 갈라지는 것을 막는다 |
| 목록 가시성 | **본인 초안만** (`createdByUserId = userId`) | 기존 `findOwnedDraft`와 같은 강도. 새 권한 모델을 만들지 않는다 ([6.2.1](#621-목록-가시성--본인-초안만)) |
| 삭제 초안 보존 | **90일 후 하드 삭제** (`cleanup-runner` job 추가) | 마스킹된 브리프도 무한 보관하지 않는다는 기존 보존 정책 ([6.2.2](#622-소프트-삭제-보존--90일-후-하드-삭제)) |
| Confluence 중복 방어 | **409 차단까지만**. 게시 측 중복 검사는 별도 백로그 | preview 경로에 외부 조회를 늘리지 않는다 ([6.2.3](#623-confluence-중복-페이지--409-차단만-잔여-위험-기록)) |
| 문서 상세도 | 2·3단계 상세, 4·5단계 개요 | 3단계가 AI 스키마와 readiness를 함께 건드리므로 2단계와 같이 설계해 둔다 |
| 범위 밖 | 다단계 승인 워크플로, 초안 버전 히스토리 테이블, 팀 공유 초안, 게시 측 중복 페이지 검사 | 기존 MVP 결정과 동일하게 유지 |

## 1. 문제 확인 (코드 근거)

기록된 증상이 실제로 코드에 있는지 먼저 확인했다. 아래는 추정이 아니라 확인된 사실이다.

| 증상 | 코드 근거 |
| --- | --- |
| 목록 API가 없다 | [`work-briefs.controller.ts`](../backend/src/work-briefs/work-briefs.controller.ts)에 `POST /brief-drafts`, `GET /brief-drafts/:id`는 있으나 컬렉션 `GET`이 없다 |
| 삭제 API가 없다 | 같은 컨트롤러에 `@Delete`가 하나도 없다 |
| 잘못 만든 초안이 이슈를 영구 점유한다 | `CONSTRAINT "UQ_work_brief_drafts_profile_source" UNIQUE ("profileId", "sourceJiraId")` — [foundation migration:203](../backend/src/database/migrations/2026080100000-work-copilot-foundation.ts). 서비스도 [`assertNoExistingDraft`](../backend/src/work-briefs/work-briefs.service.ts)로 사전 차단한다 |
| 새로고침하면 draft id가 사라진다 | draft는 `WorkBriefsPage`의 `useState<BriefDraft \| null>(null)`에만 있고([WorkBriefsPage.tsx:149](../frontend/src/features/work-briefs/WorkBriefsPage.tsx)), `frontend/package.json`에 라우터 의존성이 없다. 메뉴는 `useState<MenuName>`([App.tsx:164](../frontend/src/App.tsx)) |
| 서버는 재개 가능한데 UI에 진입점이 없다 | `GET /brief-drafts/:id/publication` → `publicationService.findLatest`가 `recoverPublicationFromSteps`로 실제 복구를 수행한다. 프런트도 [`loadPublication`](../frontend/src/features/work-briefs/WorkBriefsPage.tsx)을 갖고 있으나 **draft를 방금 만든 경우에만 호출**된다. 즉 없는 것은 복구 로직이 아니라 기존 초안을 여는 경로다 |
| AI가 완료기준·하위작업을 안 만든다 | [`contentFromAi`](../backend/src/work-briefs/work-briefs.service.ts) 384행이 `acceptanceCriteria: []`, `childTasks: []`로 고정 |
| 그런데 readiness는 그걸 요구한다 | [`readiness-coverage-evaluator.service.ts`](../backend/src/readiness/readiness-coverage-evaluator.service.ts)가 요구사항마다 하위작업·완료기준 연결을 확인하고, 없으면 `COVERAGE_MISSING`(severity `blocking`) → `publishAllowed=false` |

### 1.1 조사 중 추가로 발견한 것

계획에 영향을 주므로 같이 남긴다.

- **모든 항목이 모든 근거를 인용한다.** `contentFromAi`의 `citation()`은 `evidenceIds: [...output.evidenceIds]`로
  AI가 쓴 근거 **전체**를 title·summary·requirements·risks·nextSteps 각각에 그대로 복사한다.
  이것이 5단계에서 "항목마다 근거 전체 목록이 반복 렌더된다"고 적은 UI 문제의 실제 원인이고,
  동시에 3단계에서 완료기준을 채워도 coverage 검사(`sharesEvidence`)가 무의미하게 항상 통과하는 원인이 된다.
  **항목별 근거는 3단계에서 반드시 같이 고쳐야 한다.**
- **`TransientEvidenceFragmentsService`는 draft 생성 경로에서 호출되지 않는다.** 모듈 provider에만
  등록되어 있다. 따라서 3단계 재생성은 저장된 발췌를 재사용할 수 없고, 사용자 OAuth로 원문을
  다시 읽어야 한다. (보관을 늘리지 않는다는 점에서 오히려 정책에 맞다.)
- **nginx SPA fallback은 이미 있다.** `try_files $uri $uri/ /index.html`
  ([frontend/nginx/default.conf](../frontend/nginx/default.conf)). 라우터 도입 시 배포 설정 변경이 필요 없다.

---

## 2. 2단계 — 작업 루프 복구 (L, 백엔드 + 프런트)

목표: **브라우저를 닫아도 작업이 사라지지 않는다. 잘못 만든 초안은 지울 수 있다.**

### 2.1 데이터 모델 — 소프트 삭제

새 migration: `backend/src/database/migrations/2026080600000-brief-draft-soft-delete.ts`

```ts
export class BriefDraftSoftDelete1786000000000 implements MigrationInterface {
  name = 'BriefDraftSoftDelete1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "work_brief_drafts" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE',
    );
    // 이슈당 1개 제약은 "살아 있는" 초안에만 적용한다.
    await queryRunner.query(
      'ALTER TABLE "work_brief_drafts" DROP CONSTRAINT IF EXISTS "UQ_work_brief_drafts_profile_source"',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_work_brief_drafts_profile_source" ON "work_brief_drafts" ("profileId", "sourceJiraId") WHERE "deletedAt" IS NULL',
    );
    // 목록 API의 keyset 정렬 인덱스.
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_work_brief_drafts_owner_updated" ON "work_brief_drafts" ("createdByUserId", "updatedAt" DESC, "id" DESC) WHERE "deletedAt" IS NULL',
    );
  }
  // down: 부분 인덱스 → 테이블 제약 복원. 삭제된 행이 남아 있으면 제약 복원이 실패하므로
  // down 안에서 "deletedAt" IS NOT NULL 행을 먼저 삭제한다. 이 사실을 migration 주석에 남긴다.
}
```

**주의 지점 두 가지.**

1. `WorkBriefDraft` 엔티티에 `@DeleteDateColumn`을 쓰면 TypeORM의 `find*` 계열이 자동으로
   삭제 행을 제외한다. `WorkBriefsService` · `ReadinessService` · `PublicationService`가 각각
   `findOwnedDraft`를 갖고 있으므로(세 곳 모두 `findOneBy` 사용) 이 한 줄로 세 경로가 동시에 정리된다.
2. **`repository.update()`는 소프트 삭제 필터를 적용하지 않는다.** `updateDraft`와 `applyRefresh`의
   update criteria에 `deletedAt: IsNull()`을 **명시적으로** 추가해야 삭제된 초안이 되살아나지 않는다.
   이 두 곳은 회귀 테스트로 못 박는다.

`transient_evidence_fragments`는 draft에 `ON DELETE CASCADE`로 걸려 있는데, 소프트 삭제에서는
cascade가 돌지 않는다. 삭제 시 해당 draft의 fragment는 **즉시 하드 삭제**한다(보관 최소화 원칙).

### 2.2 `GET /brief-drafts` — 목록

**응답 타입** (`brief-draft.types.ts`에 추가):

```ts
export type BriefDraftSummary = {
  id: string;
  sourceJiraKey: string;
  title: string | null;        // access_changed면 null
  evidenceCount: number | null; // access_changed면 null
  status: DraftStatus;
  freshnessStatus: DraftFreshnessStatus;
  optimisticVersion: number;
  blockers: DraftBlocker[];
  publication: {               // 재개 진입점. 없으면 null
    id: string;
    status: PublicationStatus;
    externalWritePerformed: boolean;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BriefDraftListView = {
  items: BriefDraftSummary[];
  nextCursor: string | null;
};
```

**지켜야 할 규칙** — [`present()`](../backend/src/work-briefs/work-briefs.service.ts)의 미노출 규칙을 목록에서도 그대로 유지한다.
`freshnessStatus === 'access_changed'`면 `title`과 `evidenceCount`를 `null`로 내린다.
`sourceJiraKey`는 `present()`가 이미 노출하고 있으므로 목록도 동일하게 노출한다(일관성).
이 규칙은 요약 변환 함수 하나(`presentSummary`)에 모으고, `present()`와 같은 분기를 공유한다.

**소유자 스코프** — `findOwnedDraft`는 `{ id, createdByUserId }`로 조회한다. 목록도 동일하게
`createdByUserId = userId`만 조회한다. 프로필 스코프는 걸지 않는다(기존 `findDraft`와 동일한 강도).

**페이지네이션** — `?limit=`(기본 20, 최대 50), `?cursor=`(base64 `updatedAt|id`) keyset.
`?status=draft|review_required` 선택 필터. 2.1의 부분 인덱스가 이 정렬을 그대로 받는다.

**중요: 목록에서 publication 복구를 실행하지 않는다.** `publicationService.findLatest`는
`recoverPublicationFromSteps`를 호출하고 이것은 외부 조회를 유발할 수 있다. 목록은 저장된
`brief_publications.status`만 읽는다. 실제 복구는 사용자가 초안을 **열 때**만 일어난다.
N+1을 피하기 위해 draft id 배열에 대해 `DISTINCT ON ("draftId") ... ORDER BY "draftId", "createdAt" DESC`
한 번으로 최신 publication을 모은다.

### 2.3 `DELETE /brief-drafts/:id`

```
DELETE /brief-drafts/:id  →  204 No Content
```

**거절 규칙**

| 상황 | 응답 |
| --- | --- |
| 소유자가 아니거나 이미 삭제됨 | `404 Brief draft was not found.` (존재 여부를 흘리지 않는다) |
| 최신 publication이 `PUBLISHING` | `409 { code: 'PUBLICATION_IN_PROGRESS' }` |
| 외부 쓰기가 이미 발생함 | `409 { code: 'DRAFT_HAS_PUBLICATION' }` — 이 초안은 지우는 대신 재개/retry로 처리해야 한다. 지워 버리면 같은 이슈로 새 초안을 만들어 Confluence 페이지를 중복 생성할 수 있다 |

"외부 쓰기가 발생함"의 판정은 새로 만들지 않고 `publication.service.ts`의 기존 정의를 그대로 쓴다:
`executionMode === 'real' && Boolean(confluenceContentId)`. `mock` 모드에서 만든 초안은 삭제할 수 있다.
| 그 외 | 소프트 삭제 후 `204` |

삭제 시 수행: `deletedAt = now()` 설정 → 해당 draft의 `transient_evidence_fragments` 하드 삭제 →
`SafeAuditService.record`로 감사 이벤트 1건. 감사 이벤트에는 draft id·issue key·actor만 남기고
브리프 본문은 넣지 않는다(기존 audit 원칙 그대로).

버전 체크(`optimisticVersion`)는 삭제에 요구하지 않는다. 삭제는 lost-update가 아니고,
동시 편집 중 삭제는 다른 탭의 다음 저장이 404를 받는 것으로 충분히 드러난다.

삭제한 초안은 90일 뒤 하드 삭제된다([6.2.2](#622-소프트-삭제-보존--90일-후-하드-삭제)).
삭제 확인 UI에 "복구는 관리자 문의로만 가능하며 90일 후에는 불가"를 한 줄로 적는다.

같이 다듬을 것: `createDraft`의 `409 A brief draft already exists for this source.`는
목록이 본인 것만 보여주는 이상 사용자에게 막다른 길처럼 보인다([6.2.1](#621-목록-가시성--본인-초안만)).
"이 이슈에는 이미 브리프 초안이 있습니다(다른 사용자가 만든 것일 수 있습니다)" 수준으로 문구만 바꾼다.
소유자 정보는 노출하지 않는다.

### 2.4 프런트 — react-router 전면 도입

`react-router-dom` v7 도입. 경로 설계는 현재 `MenuName`과 1:1로 맞춰 변경 범위를 줄인다.

| 현재 `menu` | 경로 |
| --- | --- |
| `login` | `/login` |
| `posts` | `/wiki` |
| `notes` | `/notes` |
| `workBriefs` | `/briefs`, `/briefs/:draftId` |
| `integrations` | `/integrations` |
| `admin` | `/admin` |

- `App.tsx`(2020행)의 `menu` state와 `setMenu` 호출부(약 8곳)를 `useNavigate`/`<Link>`로 교체한다.
  **각 페이지 내부 state는 건드리지 않는다.** 이번 작업은 "무엇이 URL이 되는가"만 바꾼다.
- `Header`의 `onMenuClick` prop은 `<NavLink>` 기반으로 바꾸고 `MenuName` 타입은 경로 상수로 대체한다.
- 인증 가드: 세션 없으면 `/login`으로 `<Navigate replace>`. 현재 `setMenu("login")`(App.tsx:303, 608)이
  하던 일이다.
- OAuth 콜백 쿼리 처리(App.tsx:619–646의 `history.replaceState`)는 `/integrations` 라우트 안에서
  `useSearchParams`로 정리한다. 리다이렉트 URI 자체는 바꾸지 않는다.
- `?preview=work-brief` 개발 전용 분기(App.tsx:40)는 `/dev/briefs-preview` 라우트로 옮긴다.
  `import.meta.env.DEV` 가드는 유지한다.
- 배포 설정 변경 없음 — nginx fallback이 이미 있다(1.1 참고).

### 2.5 프런트 — 목록과 재개

**`/briefs` (목록)**

- `GET /brief-drafts` 결과를 카드/행으로. 각 행: 이슈 키, 제목(또는 "접근 권한 변경으로 표시 불가"),
  근거 수, 상태 배지(`draft` / `검토 필요`), 게시 상태 배지, 최종 수정 시각.
- 행 클릭 → `/briefs/:id`.
- 각 행에 삭제. 삭제는 확인 절차를 요구한다(이슈 키 표시 + 명시 확인). 409 응답은 그대로
  사유 문구로 보여 준다: 게시 진행 중 / 게시 이력 있음(→ 재개로 안내).
- 상단에 기존의 "새 브리프 시작"(이슈 키 입력) 진입. 4단계에서 이 자리에 내 담당 이슈 목록이 들어간다.

**`/briefs/:draftId` (편집·재개)**

- 마운트 시 `GET /brief-drafts/:id` → `GET /brief-drafts/:id/publication`(404면 무시) →
  필요 시 `GET /brief-drafts/:id/readiness`. **여기서 서버의 step 복구가 자동으로 돈다.**
  즉 반쯤 게시된 브리프가 열리면 `PublicationProgress`와 retry 버튼이 그대로 살아난다.
  프런트에 새 복구 로직을 만들지 않는다.
- 초안 생성 성공 시 `navigate('/briefs/' + draft.id, { replace: true })`.
- 404/403이면 목록으로 돌려보내고 사유를 표시한다.

`WorkBriefsPage`(1482행)는 이 시점에 **근거 선택 단계**와 **초안 편집 단계**로 자연 분할된다.
`/briefs`는 전자만, `/briefs/:id`는 후자만 마운트한다. 5단계 인용 UI 재설계의 사전 작업이 된다.

### 2.6 작업 분해 (PR 단위)

| PR | 내용 | 검증 |
| --- | --- | --- |
| **2-A** | migration + 엔티티 `@DeleteDateColumn` + `update()` criteria에 `IsNull()` | migration spec(기존 `*.spec.ts` 패턴), 삭제된 초안이 update/refresh/readiness/publish에서 404 |
| **2-B** | `GET /brief-drafts` (service + controller + DTO) | 아래 완료 기준 참고 |
| **2-C** | `DELETE /brief-drafts/:id` + 감사 이벤트 + fragment 하드 삭제 | 아래 완료 기준 참고 |
| **2-D** | react-router 도입. 화면 동작은 그대로 | 전 메뉴 수동 확인 + 새로고침·뒤로가기 |
| **2-E** | `/briefs` 목록 화면, `/briefs/:id` 진입, 삭제 UI | 아래 완료 기준 참고 |
| **2-F** | 90일 보존 cleanup job + health 등록 ([6.2.2](#622-소프트-삭제-보존--90일-후-하드-삭제)) | 91일 전 삭제 행만 지워지고, job이 `CleanupHealthService` 스냅샷에 나타난다 |

2-A~2-C(백엔드)와 2-D(라우터)는 서로 독립적이므로 병렬 가능하다. 2-E는 둘 다에 의존한다.
**2-A는 유일하게 되돌릴 수 없는 데이터 영향이 있으므로 단독으로 먼저 배포한다**([6.3](#63-롤백-계획)).
2-F는 2-A 이후 언제든 가능하나, 첫 삭제로부터 90일 안에는 올라가 있어야 한다.

### 2.7 완료 기준 / 검증

- 초안을 만들고 브라우저를 완전히 종료한 뒤 `/briefs`에서 그 초안을 열면, 편집 내용과 게시 진행
  상태가 그대로 복원된다. 새 초안이 만들어지지 않는다.
- Confluence까지 게시하고 Jira 단계에서 실패한 초안을 새 세션에서 열면 retry 버튼이 보이고,
  retry가 **이미 성공한 Confluence 페이지를 다시 만들지 않는다**(기존 idempotency 보존 확인).
- `access_changed` 상태의 초안은 목록에서 제목·근거 수가 노출되지 않는다. 응답 JSON에도 없다.
- 초안 A를 삭제한 뒤 같은 Jira 이슈로 초안 B를 만들 수 있다. DB에는 A가 `deletedAt`과 함께 남아 있다.
- 외부 쓰기 이력이 있는 초안 삭제는 `409 DRAFT_HAS_PUBLICATION`으로 거절된다.
- 다른 사용자의 draft id로 `GET`·`DELETE`를 호출하면 둘 다 404이고, 존재 여부가 구분되지 않는다.
- 삭제된 초안의 `transient_evidence_fragments` 행이 즉시 0건이다.
- `/briefs/:id`를 직접 붙여넣어 접속해도 404 페이지가 뜨지 않는다(nginx fallback).

---

## 3. 3단계 — 브리프 품질 (M, 주로 백엔드)

목표: **AI가 만든 브리프가 사용자의 후보 검토·선택을 거쳐 게시 조건을 만족할 수 있는 형태로 나온다.**

지금은 AI가 `acceptanceCriteria`·`childTasks`를 못 만드는데 readiness는 그걸 `blocking`으로 요구한다.
사용자가 전부 수기로 채워야 게시가 열리는 구조적 단절이다. 여기에 1.1에서 발견한 "모든 항목이
모든 근거를 인용한다" 문제를 같이 고친다. 두 개를 따로 하면 coverage 검사가 항상 통과해
3단계가 의미를 잃는다.

### 3.1 AI 출력 스키마 v2

`backend/ai-service/work_brief/service.py`의 `WORK_BRIEF_SCHEMA`를 확장한다.

```jsonc
{
  "schemaVersion": 2,
  "title":    { "text": "...", "evidenceIds": ["..."] },
  "summary":  { "text": "...", "evidenceIds": ["..."] },
  "keyPoints":          [{ "text": "...", "evidenceIds": ["..."] }],
  "acceptanceCriteria": [{ "text": "...", "evidenceIds": ["..."] }],
  "risks":              [{ "text": "...", "evidenceIds": ["..."] }],
  "nextSteps":          [{ "text": "...", "evidenceIds": ["..."] }],
  "childTasks":         [{ "summary": "...", "text": "...", "evidenceIds": ["..."] }],
  "excludedEvidence":   [{ "evidenceId": "...", "reason": "..." }]
}
```

- `strict: true` json_schema는 유지한다. 모든 배열 요소에 `additionalProperties: false`.
- `SYSTEM_INSTRUCTION`에 추가할 규칙:
  각 완료기준은 **하나 이상의 requirement와 같은 evidenceId를 공유**해야 하고,
  각 하위작업도 마찬가지다. `evidenceIds`는 그 항목을 실제로 뒷받침하는 근거만 담는다(전체 복사 금지).
  근거가 부족해 쓸 수 없는 항목은 만들지 말고 `excludedEvidence`에 사유를 남긴다.
- **DLP 재검사 확장 (놓치면 보안 회귀)**: `generate_work_brief`의 재검사 루프가 지금
  `title`·`summary`·`keyPoints`·`risks`·`nextSteps`만 돈다. `acceptanceCriteria`,
  `childTasks[].summary`, `childTasks[].text`, `excludedEvidence[].reason`을 **반드시 추가**한다.
- `_parse_model_output`의 `set(parsed) != required` 검사와 evidenceId 부분집합 검사도 새 구조에 맞춰
  갱신한다. 부분집합 검사는 **항목별로** 수행한다.

### 3.2 백엔드 검증과 매핑

- `WorkBriefAiClientService`
  - `WorkBriefOutput` 타입과 `isWorkBriefOutput` 가드를 v2 형태로 교체.
  - `assertSafeModelOutput`에 넘기는 문자열 배열에 완료기준·하위작업 텍스트·제외 사유를 포함.
  - `hasOnlyRequestedEvidence`를 **항목 단위 검증**으로 바꾼다. 항목마다 `evidenceIds`가
    비어 있지 않고 요청한 근거의 부분집합이어야 한다.
- `WorkBriefsService.contentFromAi`
  - 항목별 `evidenceIds`를 그대로 사용한다(전체 복사 제거).
  - `childTasks`: 서버가 `clientTaskId = randomUUID()`를 부여하고 **`selected: false`로 시작**한다.
    하위작업 생성은 마지막 별도 승인 단계이므로 AI가 선택 상태를 정할 수 없다. 이 불변식은 유지한다.
  - `maskContent`는 이미 `acceptanceCriteria`와 `childTasks`를 순회하므로 수정 불필요.
    다만 값 개수와 순서가 바뀌므로 인덱스 기반 치환 테스트를 추가한다.
- `StoredBriefEvidence`에 `aiExclusionReason?: string` 추가. `excludedEvidence`를 매핑하되
  **DLP를 통과한 문자열만** 저장한다.

### 3.3 재생성 경로

```
POST /brief-drafts/:id/regenerate
body: { optimisticVersion, instruction, selectedEvidenceIds? }
```

- `freshnessStatus !== 'current'`면 거절한다(초안 저장과 같은 규칙).
- `optimisticVersion` 불일치 시 기존 `DRAFT_VERSION_CONFLICT`와 동일한 409를 던진다.
- 저장된 발췌가 없으므로(1.1) `createDraft`와 같은 경로로 사용자 OAuth 원문 재조회 →
  `aiClient.generate` → `contentFromAi` → `maskContent` → in-place 교체, `optimisticVersion + 1`.
- `selectedEvidenceIds`를 주면 근거 구성을 바꿔 다시 뽑는다. 안 주면 기존 근거를 유지한다.
- **사용자가 손으로 고친 내용은 서버가 통째로 덮어쓴다.** 이 사실을 프런트에서 재생성 전에
  명시하고, 재생성 직전 내용을 클라이언트에 보관해 "되돌리기" 1회를 제공한다.
  초안 버전 히스토리 테이블은 이번 범위 밖이다.
- readiness 캐시(`readiness_assessments`)는 `assessmentVersion`이 `optimisticVersion`을 따르므로
  자동으로 무효화된다. 프런트는 재생성 후 `readinessStale = true`로 둔다(1단계에서 만든 장치 재사용).

### 3.4 프런트

- 편집 화면 상단에 "다시 생성" — instruction 편집 + 근거 재선택 + 확인 모달.
- 근거 목록의 `aiStatus === 'excluded'` 항목에 사유를 붙인다. 지금은 상태 배지만 있다.
  원문 본문은 여전히 표시하지 않는다(P2-1 결정 유지).
- 완료기준·하위작업 섹션이 생성 직후부터 채워져 있으므로, 빈 상태 문구는 "근거가 부족해 AI가
  만들지 않음"과 "아직 생성 전"을 구분해 보여 준다.

### 3.5 완료 기준 / 검증

- 근거가 충분한 fixture로 생성하면 요구사항마다 완료기준과 하위작업 후보가 연결된 채로 나온다.
- 항목별 `evidenceIds`가 서로 다르다. 모든 항목이 같은 근거 전체를 인용하는 응답은 테스트로 거절된다.
- 하위작업은 전부 `selected: false`로 생성된다. 따라서 생성 직후에는 선택된 하위작업만 보는
  readiness가 `COVERAGE_MISSING.child_task`을 낼 수 있으며, 이는 정상이다.
- 사용자가 필요한 하위작업 후보를 선택한 뒤 readiness를 실행하면 `COVERAGE_MISSING` 없이 나온다.
  사용자가 선택하지 않으면 게시 3단계가 아무것도 만들지 않는다.
- 완료기준·하위작업·제외 사유 텍스트에 한국어 PII를 심은 synthetic 모델 응답이 마스킹된다.
  (DLP 재검사 확장 회귀 테스트 — `backend/ai-service/tests/test_work_brief_dlp.py`에 케이스 추가)
- 요청하지 않은 evidenceId를 항목에 넣은 모델 응답은 `503`으로 거절된다(기존 정책 유지).
- 재생성 후 `optimisticVersion`이 1 증가하고, 재생성 전 버전으로 저장을 시도하면 409가 난다.
- ai-service와 백엔드는 **같은 릴리스로 배포**한다. ai-service만 먼저 올라가면 백엔드 스키마
  검증이 전부 실패해 브리프 생성이 멈춘다. 배포 순서를 릴리스 노트에 명시한다.

---

## 4. 4단계 개요 — 시작 편의 (M)

지금은 이슈 키를 외워야 시작할 수 있다.

- **내 담당 이슈 목록**: `work-items.controller.ts`에 `GET /work-items/jira/my-issues` 추가.
  JQL `assignee = currentUser() AND resolution = Unresolved`를 사용자 OAuth로 조회하고,
  `IntegrationAccessPolicyService.assertAllowedProject`로 허용 프로젝트만 남긴다.
  이미 초안이 있는 이슈는 목록에서 "초안 있음"으로 표시하고 `/briefs/:id`로 보낸다(2단계 결과 재사용).
- **Confluence space 드롭다운**: `GET /work-items/confluence/spaces`. 서버는 활성 프로필의
  `allowedSpaceKeys`를 이미 알고 있다([integration-access-policy.service.ts](../backend/src/work-items/integration-access-policy.service.ts)).
  키만 내려도 되지만 표시명이 필요하면 사용자 OAuth로 space 메타데이터를 조회한다.
  **allowlist 밖 space는 어떤 경로로도 노출하지 않는다.**
- **최근 사용 이슈**: 2단계 `GET /brief-drafts`의 `updatedAt` 정렬로 대부분 해결된다.
  별도 테이블 없이 목록 상단 N개를 재활용한다.

전제: 2단계의 `GET /brief-drafts`가 있어야 "초안 있음" 표시와 최근 목록이 성립한다.

## 5. 5단계 개요 — 인용 UI 재설계 (M)

`CitationEditor`가 항목마다 전체 근거 체크박스 목록을 렌더한다
([WorkBriefsPage.tsx:1257~](../frontend/src/features/work-briefs/WorkBriefsPage.tsx)).
요구사항 10개 × 근거 15개면 체크박스 150개가 한 화면에 쌓인다.

방향:

- 기본 상태는 **연결된 근거 칩(chip) 몇 개만** 표시. 편집은 팝오버/드로어에서, 검색 가능한 목록으로.
- 근거 선택 UI를 컴포넌트 하나로 뽑아 title·summary·리스트·하위작업이 공유하게 한다.
- 근거 → 항목의 역방향 보기("이 문서는 어떤 항목에 쓰였나")를 추가하면 검토 속도가 크게 달라진다.

**전제**: 3단계에서 항목별 `evidenceIds`가 실제로 달라져야 이 재설계가 의미를 갖는다.
지금처럼 모든 항목이 모든 근거를 인용하는 상태에서 UI만 접으면 정보가 아니라 소음을 접는 것이다.
따라서 **5단계는 3단계 이후**에 한다. 2단계의 페이지 분할(2.5)이 사전 작업이다.

---

## 6. 위험 등록부

각 위험은 "언제 터지는가 / 터지기 전에 어떻게 아는가 / 무엇으로 막는가"까지 적는다.
탐지 수단이 없는 위험은 대응이 있어도 관리되는 위험이 아니다.

### 6.1 등록부

| ID | 위험 | 등급 | 발생 조건 | 탐지 | 대응 | 담당 |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | `repository.update()`가 소프트 삭제를 무시해 삭제된 초안이 되살아난다 | **높음** | `updateDraft`·`applyRefresh`의 update criteria에 `deletedAt: IsNull()`을 빠뜨림. 타입 검사로 안 잡힌다 | 회귀 테스트: 삭제 → 이전 `optimisticVersion`으로 PATCH·refresh → 404 기대 | criteria 명시 + 두 경로 각각 테스트. 리뷰 체크리스트 항목으로 고정 | 2-A |
| R2 | 부분 unique 인덱스가 실제로는 중복을 막지 못한다 | **높음** | migration이 기존 테이블 제약을 `DROP`했는데 부분 인덱스 생성이 실패하거나 조건이 틀림 | migration spec에서 같은 `(profileId, sourceJiraId)`로 살아 있는 행 2개 삽입 → 실패 기대 / 삭제 후 삽입 → 성공 기대 | up() 안에서 DROP과 CREATE를 한 트랜잭션으로. 두 방향 모두 테스트 | 2-A |
| R3 | `down()` 마이그레이션이 삭제 행 때문에 실패한다 | 중간 | 롤백 시점에 `deletedAt IS NOT NULL` 행이 있고 그 중 `(profileId, sourceJiraId)`가 겹친다 | migration spec에서 up → 삭제 행 생성 → down 실행 | down()이 `deletedAt IS NOT NULL` 행을 먼저 삭제한다. **롤백은 되돌릴 수 없는 데이터 손실**임을 migration 주석과 릴리스 노트에 명시 | 2-A |
| R4 | 목록 API가 초안 수만큼 외부 조회를 유발한다 | **높음** | 요약에 게시 상태를 넣으려고 `publicationService.findLatest`를 재사용하면 `recoverPublicationFromSteps`가 초안마다 돈다 | 목록 API 테스트에서 write gateway mock의 호출 횟수 0 단언 | 목록은 `brief_publications`를 `DISTINCT ON ("draftId")` 한 번으로 읽는다. 복구는 상세 진입 시에만 | 2-B |
| R5 | `access_changed` 초안의 제목·근거가 목록으로 새어 나간다 | **높음** | `presentSummary`가 `present()`의 미노출 분기를 재현하지 않음 | 응답 JSON 전체를 문자열로 훑어 초안 제목이 없는지 단언하는 테스트 | 분기를 함수 하나로 공유. 목록·상세 양쪽 테스트 | 2-B |
| R6 | 삭제 후 같은 이슈 재게시로 Confluence 페이지가 중복 생성된다 | 중간 | 외부 쓰기 이력이 있는 초안이 삭제되고, 같은 이슈로 새 초안을 만들어 게시한다 | — (사후에만 드러난다) | 외부 쓰기 이력이 있으면 삭제를 `409 DRAFT_HAS_PUBLICATION`으로 막는다. **잔여 위험은 6.2.3 참고** | 2-C |
| R7 | AI 스키마 v2 배포 순서가 어긋나 브리프 생성이 전부 멈춘다 | **높음** | ai-service만 먼저 배포되면 백엔드 `isWorkBriefOutput`이 전부 실패해 모든 생성이 503 | `work_brief_ai_duration_ms{operation=generate,outcome=failure}` 급증 | 백엔드·ai-service를 같은 릴리스로 배포. 배포 직후 생성 1건 smoke test | 3단계 |
| R8 | 새 필드가 DLP 재검사를 우회한다 | **높음** | `generate_work_brief`의 재검사 루프에 `acceptanceCriteria`·`childTasks`·`excludedEvidence[].reason`을 추가하지 않음 | 각 신규 필드에 한국어 PII를 심은 synthetic 모델 응답 테스트 | 필드별 케이스를 `test_work_brief_dlp.py`에 추가. 백엔드 `assertSafeModelOutput` 인자에도 포함 | 3단계 |
| R9 | 기존 초안과 신규 초안의 인용 품질이 갈린다 | 중간 | 3단계 배포 전에 만들어진 초안은 모든 항목이 전체 근거를 인용한 상태로 남는다. 그 초안의 coverage 검사는 계속 느슨하게 통과한다 | — (구조적으로 예상되는 상태) | **데이터 마이그레이션을 하지 않는다.** AI가 어떤 근거를 어디에 연결했는지 사후에 복원할 수 없고, 추측으로 채우면 화면이 다시 거짓말한다. 재생성(3.3)으로만 갱신되게 두고 이 사실을 릴리스 노트에 적는다 | 3단계 |
| R10 | 재생성이 수기 편집을 덮어쓴다 | 중간 | 사용자가 오래 손본 초안에서 "다시 생성"을 누른다 | — (사용자가 즉시 인지) | 확인 모달에서 덮어쓴다는 사실을 명시 + 재생성 직전 내용을 클라이언트에 보관해 되돌리기 1회 제공. 버전 히스토리는 범위 밖 | 3단계 |
| R11 | 라우터 도입이 `App.tsx` 전면 리팩터링으로 번진다 | 중간 | 2020행을 열면 정리하고 싶은 것이 계속 나온다 | PR diff 크기. 페이지 컴포넌트 내부가 바뀌면 범위 이탈 | 2-D는 `menu` state → URL 승격만. 페이지 내부 state·레이아웃·스타일은 손대지 않는다. 별도 정리는 별도 PR | 2-D |
| R12 | keyset 페이지네이션이 항목을 중복·누락시킨다 | 낮음 | 목록을 넘기는 중에 초안이 수정되어 `updatedAt`이 바뀐다 | — | 커서에 `id` 타이브레이커를 포함한다. 그래도 남는 흔들림은 사용자 영향이 작아 수용한다(초안 20개 규모) | 2-B |
| R13 | 90일 보존이 조용히 지켜지지 않는다 | 중간 | cleanup cron이 멈췄는데 아무도 모른다 | `CleanupHealthService`에 신규 job을 등록해 `lastSuccessAt` 노후를 기존 알림으로 잡는다 | 6.2.2 구현에 job 등록을 포함한다. 등록을 빼면 삭제만 안 되는 게 아니라 **안 된다는 사실도 안 보인다** | 2-F |
| R14 | 보존 job이 FK 위반으로 매번 실패한다 | 중간 | `brief_publications`가 `ON DELETE RESTRICT`인데 job이 초안만 지우려 한다 | job 실패가 cleanup health에 바로 잡힌다 | publication → 초안 순서로 지우고, 외부 쓰기 이력이 있으면 건너뛴다. 상세는 6.2.2 | 2-F |

### 6.2 확정된 정책

앞선 초안에서 미결로 남겼던 세 가지를 확정한다.

#### 6.2.1 목록 가시성 — 본인 초안만

`GET /brief-drafts`는 `createdByUserId = userId`만 조회한다. 기존 `findOwnedDraft`와 같은 강도이고,
2단계에서 새 권한 모델을 만들지 않는다.

받아들이는 비용: 동료가 이미 초안을 만든 이슈는 새로 시작할 때 `409 A brief draft already exists`로만
알 수 있고, 누가 작업 중인지는 보이지 않는다. 이건 **버그가 아니라 이번 단계의 알려진 한계**이므로
409 문구를 "이 이슈에는 이미 브리프 초안이 있습니다(다른 사용자일 수 있음)" 수준으로 다듬어
막다른 길처럼 보이지 않게 한다. 팀 가시성이 필요해지면 소유자 표시 범위부터 다시 설계해야 하고,
그건 2단계를 넘는 별도 작업이다.

#### 6.2.2 소프트 삭제 보존 — 90일 후 하드 삭제

마스킹된 브리프라도 무한 보관하지 않는다는 기존 보존 정책과 같은 방향이다.
게시 이력이 있는 초안은 애초에 삭제가 막히므로(R6) 감사 추적은 이 job으로 사라지지 않는다.

기존 `cleanup-runner`를 확장한다. **건드려야 하는 곳이 흩어져 있으니 다섯 곳을 모두 본다.**

| 파일 | 변경 |
| --- | --- |
| `operations/cleanup-runner.ts` | `CleanupRunnerJob`에 `'deleted_brief_drafts'` 추가. 기존 job은 `expiresAt <= now` 형태라 재사용할 수 없다. `deletedAt <= now - 90d` 분기를 별도로 둔다 |
| `operations/cleanup-main.ts` | `entities` 배열에 `WorkBriefDraft` 추가. 빠뜨리면 런타임에 repository를 못 찾는다 |
| `operations/cleanup-health.service.ts` | `CleanupJob` union과 `JOBS` 배열에 추가 (R13) |
| 환경변수 | `WORK_BRIEF_DRAFT_RETENTION_DAYS`(기본 90). 기존 보존 설정과 같은 방식으로 읽는다 |
| 릴리스 노트 | 삭제한 초안은 90일 뒤 복구 불가임을 사용자에게 알린다 |

**FK 방향을 실제 스키마에서 확인했다. 여기서 job 설계가 갈린다.**

| 자식 테이블 | FK | 하드 삭제 시 |
| --- | --- | --- |
| `transient_evidence_fragments` | `ON DELETE CASCADE` | 자동 삭제. 2.3에서 이미 지웠으므로 보통 0건 |
| `readiness_assessments` | `ON DELETE CASCADE` | 자동 삭제 |
| `brief_publications` | **`ON DELETE RESTRICT`** | **초안 삭제가 실패한다** (`publication_steps`는 publication에 CASCADE) |

즉 게시를 한 번이라도 **시도**한 초안은 그냥 `DELETE`하면 FK 위반으로 job이 터진다.
그런데 2.3의 삭제 규칙 때문에 소프트 삭제까지 도달할 수 있는 publication은
`mock` 모드이거나 Confluence 단계에서 실패해 `confluenceContentId`가 없는 것뿐이다 —
**외부에 아무것도 만들어지지 않은 publication**이다. 따라서 job은 이렇게 동작한다.

1. `deletedAt <= now - 90d`인 초안을 모은다.
2. 각 초안에 대해 `executionMode = 'real' AND "confluenceContentId" IS NOT NULL`인
   publication이 있으면 **건너뛰고 `skippedCount`로 센다**. (정상 경로로는 생길 수 없다.
   DB 직접 수정 같은 경로로 생긴 것이므로 조용히 지우면 안 된다.)
3. 아니면 `brief_publications` 삭제(→ `publication_steps` CASCADE) → 초안 삭제.

`CleanupRunnerResult`의 job 항목에 `skippedCount`를 추가하고, 0이 아니면 `CleanupHealthService`가
`degraded`로 보이게 한다. 이게 R6의 잔여 위험을 사후에라도 드러내는 유일한 신호다.

Cron 주기는 기존 시간당 실행을 그대로 쓴다. 대부분의 실행에서 `deletedCount: 0`이 정상이며,
이를 실패로 보지 않는다.

#### 6.2.3 Confluence 중복 페이지 — 409 차단만, 잔여 위험 기록

2단계는 "외부 쓰기 이력이 있으면 삭제 자체를 막는다"까지만 한다. 게시 직전에 같은 제목·parent의
페이지가 이미 있는지 조회하는 방어는 넣지 않는다 — publication preview 경로에 외부 조회가
한 번 더 늘고 2단계 범위가 커진다.

**남는 위험을 그대로 적어 둔다.** 다음 경로로는 여전히 중복 페이지가 생길 수 있다.

- 관리자가 DB에서 초안을 직접 지우거나 `deletedAt`을 수동으로 설정한 경우
- Confluence에서 페이지를 지운 뒤 초안을 삭제하고 다시 만든 경우
- 같은 이슈로 만든 초안을 서로 다른 사용자가 각각 게시하는 경우(초안 unique는 살아 있는 초안
  하나만 보장하지, 과거에 만들어진 Confluence 페이지를 보장하지 않는다)

반면 **90일 보존 job으로 인한 중복은 발생하지 않는다.** `brief_publications`가
`ON DELETE RESTRICT`이고 job이 외부 쓰기 이력 있는 초안을 건너뛰기 때문이다(6.2.2).

게시 측 중복 방지는 **별도 백로그 항목**으로 올린다. 이 문서에서 다루지 않는다는 뜻이지,
없어도 된다는 뜻이 아니다.

### 6.3 롤백 계획

| 대상 | 롤백 방법 | 데이터 영향 |
| --- | --- | --- |
| 2-A migration | `down()` 실행 | **손실 있음.** 소프트 삭제된 초안이 하드 삭제된다(R3). 롤백 전 백업 필수 |
| 2-B / 2-C API | 백엔드 이미지 되돌리기 | 없음. `deletedAt` 컬럼이 남아 있어도 이전 코드는 무시한다 |
| 2-D / 2-E 프런트 | 프런트 이미지 되돌리기 | 없음. URL이 이전 형태로 돌아갈 뿐 |
| 3단계 AI 스키마 v2 | 백엔드·ai-service **동시** 되돌리기 | 없음. `BriefContent` 타입은 이미 `acceptanceCriteria`·`childTasks`를 갖고 있어 v2로 만든 초안도 이전 코드가 읽는다. 재생성 엔드포인트만 사라진다 |

2-A만 되돌릴 수 없는 데이터 영향이 있다. **2-A는 단독 PR로 먼저 배포하고 며칠 관찰한 뒤**
나머지를 올린다. 이 순서는 2.6의 PR 분해와 일치한다.
