# Work Copilot 실무 사용성 개선 — 4·5단계 실행 계획

[2·3단계 계획](./work-copilot-usability-phase2-plan.md)의 후속이다. 그 문서가 개요로만 남긴
4·5단계를 착수 가능한 수준으로 적는다.

**먼저 확인한 사실: 4단계는 이미 구현되어 있고, 5단계는 착수되지 않았다.** 이 문서는 그래서
4단계를 "검증과 잔여 갭"으로, 5단계를 "실행 계획"으로 다룬다. 근거는 [1장](#1-현재-상태-코드-근거)에 있다.

## 0. 이 문서의 확정값

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 4단계 취급 | **검증 + 잔여 갭 1건**. 재설계하지 않는다 | 구현이 원 계획과 일치한다 ([1.2](#12-4단계는-구현되어-있다)) |
| 인용 편집 UI | **칩 + 팝오버**. 항목별 전체 체크박스 목록 제거 | 요구사항 10 × 근거 15 = 체크박스 150개가 한 화면에 쌓이는 문제의 직접 원인 |
| 칩 표시 | **번호(E1·E2…) + 툴팁**. 제목은 툴팁과 `aria-label`로 | Confluence 문서명이 길어 칩에 제목을 넣으면 항목당 두세 줄을 먹는다 |
| 근거 번호 기준 | **화면 목록 순서**(`draft.evidence` 배열). 저장하지 않는다 | 번호는 표시 전용이다. 서버·게시 경로에는 넘기지 않는다 ([3.2](#32-근거-번호--표시-전용-불변식)) |
| excluded 근거 | **기본 숨김 + 펼침**. 사유와 함께 선택 가능 | AI 판단을 보여 주되 사용자 판단을 막지 않는다 |
| 역방향 보기 | **포함, 읽기 전용**. 근거 행에 사용처 요약 | 연결 해제는 팝오버 한 곳으로만 유지한다 ([3.5](#35-역방향-보기--읽기-전용)) |
| 팝오버 구현 | **네이티브 `popover` 속성 + JS 위치 계산** | 닫기·레이어는 브라우저가 맡고, CSS anchor positioning의 좁은 지원 범위는 피한다 ([3.4](#34-팝오버)) |
| 반영 시점 | **즉시 반영**. 팝오버에 적용/취소 버튼 없음 | 현재 동작과 같고, 뒤의 칩이 실시간으로 바뀌어 피드백이 즉각적이다 |
| 리팩터 범위 | **인용 관련 컴포넌트만 분리**. 페이지 구조는 그대로 | [R11](./work-copilot-usability-phase2-plan.md#61-등록부)과 같은 성질의 범위 이탈을 막는다 |
| 배지 갭 수정 | **`GET /brief-drafts`에 `sourceJiraKeys` 필터 추가** | 가시성 규칙을 한 곳에 유지하고 모듈 의존 방향을 뒤집지 않는다 ([2.2](#22-갭-초안-있음-배지가-첫-페이지에만-대조된다)) |
| 검증 | design-qa 프리뷰 픽스처 갱신 + 순수 함수 spec | 기존 `*-copy.spec.ts` 패턴과 `/dev/briefs-preview`를 그대로 쓴다 |
| 범위 밖 | 게시 측 Confluence 중복 검사, 팀 가시성, 초안 버전 히스토리, 근거 그룹/태그 | [5장](#5-백로그)에 모아 다음 계획의 입력으로 남긴다 |

---

## 1. 현재 상태 (코드 근거)

### 1.1 2·3단계는 완료되었다

`git log` 기준으로 2단계(`afc1260`~`8ed5f38` 및 후속 fix)와 3단계(`b765d50`~`3949194`)가 들어가 있다.
이 문서가 의존하는 산출물만 확인했다.

| 산출물 | 위치 |
| --- | --- |
| 소프트 삭제 + 목록 API | [`listDrafts`](../backend/src/work-briefs/work-briefs.service.ts) (work-briefs.service.ts:151). keyset 커서, `findLatestStoredSummaries`로 N+1 회피 ([R4](./work-copilot-usability-phase2-plan.md#61-등록부) 대응 주석이 코드에 남아 있다) |
| 라우팅 | [`routes.ts`](../frontend/src/routes.ts). `MENU_PATHS`, `draftIdFromPathname` |
| 목록 화면 | [`BriefDraftList.tsx`](../frontend/src/features/work-briefs/BriefDraftList.tsx) (285행) |
| AI 스키마 v2 | 항목별 `evidenceIds`. `WorkEvidence.aiExclusionReason`이 [`work-briefs.types.ts`](../frontend/src/features/work-briefs/work-briefs.types.ts)에 있다 |
| 재생성 | `POST /brief-drafts/:id/regenerate` + `RegenerateDialog` |

### 1.2 4단계는 구현되어 있다

| 원 계획 항목 | 구현 |
| --- | --- |
| 내 담당 이슈 목록 | `GET /work-items/jira/my-issues` ([controller:26](../backend/src/work-items/work-items.controller.ts), [`listAssignedIssues`](../backend/src/work-items/jira/jira-work-item.service.ts) 233행). 허용 프로젝트만 JQL에 넣고, `currentUser()`를 써서 사용자 식별자를 보내지 않는다 |
| "초안 있음" 표시 | [`AssignedIssueList.tsx`](../frontend/src/features/work-briefs/AssignedIssueList.tsx) + [`matchAssignedIssues`](../frontend/src/features/work-briefs/assigned-issue-copy.ts). 초안이 있으면 "초안 열기"로 `/briefs/:id`로 보낸다 |
| Confluence space 드롭다운 | `GET /work-items/confluence/spaces` ([controller:57](../backend/src/work-items/work-items.controller.ts)). 프런트는 [WorkBriefsPage.tsx:285](../frontend/src/features/work-briefs/WorkBriefsPage.tsx)에서 읽고, 실패 시 수동 입력 필드를 남긴다 |
| 최근 사용 이슈 | 별도 테이블 없이 `GET /brief-drafts`의 `updatedAt` 정렬로 대체됐다. 원 계획대로다 |

빈 상태 문구도 [`assignedIssueEmptyText`](../frontend/src/features/work-briefs/assigned-issue-copy.ts)가
`access_limited` · `not_found` · 정말로 0건을 구분한다. **재설계할 이유가 없다.**

### 1.3 5단계는 착수되지 않았다

[`CitationEditor`](../frontend/src/features/work-briefs/WorkBriefsPage.tsx) (WorkBriefsPage.tsx:1692)가
여전히 `evidence.map`으로 전체 근거를 체크박스로 편다.

```tsx
<fieldset>
  <legend>근거 연결</legend>
  {evidence.map((item) => (
    <Checkbox checked={citation.evidenceIds.includes(item.id)} ... />
  ))}
</fieldset>
```

호출부가 4곳이다: 제목(1218), 요약(1226), `CitationListEditor` 내부(1795), `ChildTaskEditor` 내부(1899).
`CitationListEditor`는 요구사항·완료기준·위험·다음단계 네 섹션에 쓰이므로,
요구사항 10개·근거 15개면 실제 체크박스 수는 요구사항 섹션에서만 150개다.

### 1.4 계획에 영향을 주는 추가 발견

- **디자인 시스템에 팝오버·다이얼로그 프리미티브가 없다.** [`components.tsx`](../frontend/src/design-system/components.tsx)에
  있는 것은 Button(17) · IconButton(44) · TextInput(65) · Select(69) · TextArea(73) · Checkbox(82) ·
  Alert(99) · Badge(121) · StatusIndicator(132) · Card(147)뿐이다. 팝오버는 새로 만들어야 한다.
- **팝오버에 대한 기존 판단이 코드 주석에 있다.** [`work-briefs.css:255`](../frontend/src/features/work-briefs/work-briefs.css):
  "재생성은 손으로 고친 내용을 덮어쓰므로, 실수로 닫힐 수 있는 코너 팝오버 대신 에디터 위 인라인에 둔다."
  **이 판단과 충돌하지 않는다.** 그 주석은 되돌릴 수 없는 동작의 확인 절차에 대한 것이고,
  근거 연결은 되돌릴 수 있고 저장 전이며 실수로 닫혀도 손실이 없다. 5단계 PR 설명에 이 구분을 적는다.
- **`ValidationPipe`가 `forbidNonWhitelisted: true`다** ([main.ts:44](../backend/src/main.ts)).
  DTO에 없는 쿼리 파라미터는 400이 된다. 4단계 갭 수정의 **배포 순서를 강제한다**([2.4](#24-배포-순서와-롤백)).
- **`MAX_ASSIGNED_ISSUES = 20`이 하드 절단이다**([jira-work-item.service.ts:23](../backend/src/work-items/jira/jira-work-item.service.ts)).
  잘렸다는 사실이 응답에도 화면에도 없다. 이번 범위에 넣지 않고 [5장](#5-백로그)으로 보낸다.

---

## 2. 4단계 — 검증과 잔여 갭

### 2.1 검증 체크리스트

구현을 바꾸지 않고, 아래가 실제로 성립하는지 확인해 결과를 남긴다.
성립하지 않는 항목이 나오면 그때 별도 작업으로 올린다.

**결과(2026-08-06): 7개 항목 전부 성립.** 근거는 각 항목에 적었다.
검증 중 코드가 아니라 **테스트에 구멍이 하나** 있어 그것만 메웠다(4번 항목).

- [x] 담당 이슈가 있는 계정으로 `/briefs`를 열면 "내 담당 이슈"에 이슈가 나오고, 이슈 키를 몰라도 시작할 수 있다.
      — `AssignedIssueList`가 마운트 시 스스로 조회한다. spec: `assigned-issue-lookup.spec.ts`
- [x] 허용 프로젝트 밖의 담당 이슈는 목록에 **없다**. (JQL이 `allowedProjectKeys`로 좁혀졌는지)
      — JQL의 `project in (...)`와 행별 `assertAllowedProject` **두 번** 건다.
      spec `lists the assigned issues of the calling user within the allowed projects`가
      Jira가 `OPS-9`를 돌려줘도 떨어지는 것을 단언한다
- [x] Jira 연결이 끊긴 계정에서 목록이 "권한으로 읽을 수 없습니다" 문구로 떨어지고, 이슈 키 수동 입력은 계속 된다.
      — `accessStatus: 'access_limited'` → `assignedIssueEmptyText`. 목록만 문구로 바뀌고
      수동 입력 필드는 `WorkBriefsPage`의 별 영역이라 영향받지 않는다
- [x] 허용 프로젝트가 0개인 프로필에서 담당 이슈 조회가 **외부 호출 없이** 빈 목록을 준다.
      — 코드는 성립하나 **테스트가 없었다**. spec
      `answers an empty allowlist without reaching the provider at all`을 추가해
      `getAccessToken`·`getJson` 미호출을 단언한다
- [x] space 드롭다운에 allowlist 밖 space가 어떤 경로로도 나오지 않는다. 응답 JSON에도 없다.
      — `listAllowedSpaces`가 `profile.allowedSpaceKeys`에서 출발하고 provider 응답으로
      목록을 늘리지 않는다. spec `lists the allowlisted spaces with names and never a space outside it`
- [x] space 이름 조회가 실패한 space도 **선택은 된다**(`name: null`, `accessStatus: access_limited`).
      — spec `keeps every other allowlisted space when one metadata request fails` +
      프런트 `always shows the key and says when the display name is missing`
- [x] 이미 초안이 있는 이슈에서 "초안 열기"를 누르면 새 초안이 생기지 않고 `/briefs/:id`로 간다.
      — `draftId`가 있으면 버튼이 `onOpenDraft`로 바뀐다. 생성 경로를 타지 않는다

### 2.2 갭: "초안 있음" 배지가 첫 페이지에만 대조된다

**해소됨.** 아래 설계는 `GET /brief-drafts?sourceJiraKeys=`를 전제했지만, 실제 구현은
**`POST /brief-drafts/lookup`** 전용 엔드포인트로 들어갔다
([`lookupDraftsForAssignedIssues`](../backend/src/work-briefs/work-briefs.service.ts),
[`assigned-issue-lookup.ts`](../frontend/src/features/work-briefs/assigned-issue-lookup.ts)).
바뀐 것과 지켜진 것은 이렇다.

| | 계획 | 구현 | 판단 |
| --- | --- | --- | --- |
| 계약 | `GET`에 쿼리 필터 | `POST` 전용 엔드포인트 | 목록 표현(`presentSummary`·커서·publication 조인)을 배지 조회가 상속하지 않아 더 낫다. `forbidNonWhitelisted` 배포 순서 제약([2.4](#24-배포-순서와-롤백))은 **그대로** 적용된다 — 신설 라우트라 프런트가 먼저 뜨면 400 대신 404를 받을 뿐이다 |
| 소유자 스코프 | `andWhere`로 추가 | `where: { createdByUserId, profileId, ... }` | R21은 막혔다. 게다가 `profileId`까지 좁혀 **다른 프로필의 같은 Jira 키**가 배지로 새지 않는다 — 계획보다 강하다 |
| 반환 형태 | 목록 요약 | `id`·`sourceJiraKey`만 | 계획의 "배지에는 title이 필요 없다"를 타입으로 강제한다 |
| 실패 처리 | 배지 없이 렌더(R23) | **목록 전체가 unavailable** | **의도적 이탈.** lookup 없이 행을 조작 가능하게 두면 "근거 선택"이 409로 끝나 배지 없는 화면이 곧 막다른 길이 된다. spec `does not make an assigned issue actionable before its draft lookup finishes`가 이 판단을 고정한다 |

`onItemsChange` 제거(2.3)도 완료됐다 — 현재 `BriefDraftList`에 해당 prop이 없다.
아래 2.2~2.4 본문은 **이 결정의 기록**으로 남긴다.

[`matchAssignedIssues`](../frontend/src/features/work-briefs/assigned-issue-copy.ts)는 `AssignedIssueList`가
prop으로 받은 `drafts`와 담당 이슈를 맞춘다. 그런데 그 `drafts`는 `BriefDraftList`가 **첫 페이지로 로드한
20건**(`DRAFT_LIST_DEFAULT_LIMIT`)이다. 초안이 20건을 넘으면 커서 뒤에 있는 초안은 배지가 붙지 않고,
사용자는 "근거 선택"을 눌렀다가 `409 A brief draft already exists`를 본다.
2단계에서 없애려던 막다른 길이 조건부로 살아 있는 것이다.

**서버에서 담당 이슈 키로 직접 조회한다.** 담당 이슈는 최대 20개이므로 조회 대상이 명확하고 유한하다.

```
GET /brief-drafts?sourceJiraKeys=PROJ-1,PROJ-2,...
```

`ListBriefDraftsDto`([dto/brief-draft.dto.ts:150](../backend/src/work-briefs/dto/brief-draft.dto.ts))에 추가한다.

```ts
@IsOptional()
@Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
@IsArray()
@ArrayMaxSize(DRAFT_LIST_ISSUE_KEY_FILTER_MAX)   // 20. MAX_ASSIGNED_ISSUES와 같은 값
@Matches(/^[A-Z][A-Z0-9_]{0,31}-[1-9][0-9]*$/, { each: true })
sourceJiraKeys?: string[];
```

`listDrafts`에는 조건 한 줄만 더한다.

```ts
if (query.sourceJiraKeys?.length) {
  builder.andWhere('draft."sourceJiraKey" IN (:...keys)', {
    keys: query.sourceJiraKeys,
  });
}
```

**지켜야 할 것.**

- 필터는 `createdByUserId` 스코프 **안에서** 걸린다. 기존 `where` 절을 대체하지 않고 `andWhere`로 더한다.
  이걸 어기면 동료의 초안 존재 여부가 배지로 새어 나간다([R21](#41-위험-등록부-4단계-갭)).
- `presentSummary`의 `access_changed` 미노출 규칙은 그대로 적용된다. 배지에는 `title`이 필요 없으므로
  프런트가 `id`와 `sourceJiraKey`만 쓴다.
- 인덱스를 새로 만들지 않는다. `IDX_work_brief_drafts_owner_updated`가 `createdByUserId`로 이미 좁히고,
  사용자당 초안은 수십 건 규모다. `sourceJiraKey` 인덱스를 이 규모에 추가할 이유가 없다.
- `findLatestStoredSummaries`가 필터 조회에도 그대로 돈다. 저장된 행만 읽으므로 외부 호출은 0건이고
  ([R4](./work-copilot-usability-phase2-plan.md#61-등록부)의 불변식 유지), 별도 경량 경로를 만들지 않는다.

### 2.3 프런트 변경

`AssignedIssueList`가 `drafts` prop 의존을 버리고 스스로 조회한다.

1. `GET /work-items/jira/my-issues` → 이슈 키 수집
2. 이슈가 0건이면 **두 번째 요청을 보내지 않는다**
3. `GET /brief-drafts?sourceJiraKeys=<수집한 키>` → `matchAssignedIssues`에 넘긴다

`matchAssignedIssues`는 시그니처를 바꾸지 않는다. 입력이 "화면에 로드된 초안"에서 "이 이슈들의 초안"으로
바뀔 뿐이고, 이 함수의 spec은 그대로 통과해야 한다.

**배지 조회 실패는 목록을 죽이지 않는다.** 두 번째 요청이 실패하면 배지 없이 렌더하고,
사용자가 "근거 선택"을 눌렀을 때의 409는 기존 문구([`createDraftFailureMessage`](../frontend/src/features/work-briefs/brief-draft-error-copy.ts))가 받는다.
배지는 편의이고 409는 정확성이다. 편의가 실패했다고 정확성까지 잃을 필요는 없다.

`BriefDraftList`의 `onItemsChange` prop은 이 변경 후 소비자가 없어진다. 같은 PR에서 제거한다.

### 2.4 배포 순서와 롤백

`forbidNonWhitelisted: true`([1.4](#14-계획에-영향을-주는-추가-발견)) 때문에 순서가 강제된다.

| | 순서 |
| --- | --- |
| 배포 | **백엔드 먼저**, 그다음 프런트. 반대로 하면 프런트가 보낸 `sourceJiraKeys`가 400을 받아 담당 이슈 목록이 통째로 unavailable로 떨어진다 |
| 롤백 | **프런트 먼저**, 그다음 백엔드. 백엔드만 되돌리면 같은 400이 난다 |

이 순서를 릴리스 노트와 PR 설명에 적는다. 데이터 영향은 없다 — 마이그레이션도 컬럼 추가도 없다.

---

## 3. 5단계 — 인용 UI 재설계

목표: **근거가 많아도 브리프를 읽고 고칠 수 있다. 어떤 근거가 어디에 쓰였는지 눈으로 확인된다.**

전제는 3단계에서 이미 충족됐다. 항목별 `evidenceIds`가 실제로 서로 다르므로, UI를 접는 것이
정보를 접는 게 아니라 소음을 접는 것이 된다.

### 3.1 컴포넌트 분리 (먼저 한다)

새 디렉터리 `frontend/src/features/work-briefs/citations/`로 옮긴다.

| 옮기는 것 | 현재 위치 |
| --- | --- |
| `CitationEditor` | WorkBriefsPage.tsx:1692 |
| `CitationListEditor` | WorkBriefsPage.tsx:1757 |
| `ChildTaskEditor` | WorkBriefsPage.tsx:1826 |
| `EvidenceList` | WorkBriefsPage.tsx:1646 |
| `emptyCitation` | WorkBriefsPage.tsx:140 |

**의존 함수는 이미 전부 별 모듈에 있다.** `providerLabel`은 `integrations/connection-status`에서,
`emptySectionNotice`와 `excludedEvidenceReason`은 `brief-regeneration-copy`에서 import된다
(WorkBriefsPage.tsx:44–68). 옮기는 컴포넌트가 import 경로만 바꿔 달면 되고, 새로 뺄 공용 모듈이 없다.
`providerLabel`은 페이지 본문(1079·1328)에서도 쓰이므로 **인용 디렉터리로 옮기지 않는다** —
옮기면 페이지가 인용 모듈을 거쳐 import하게 되어 의존 방향이 뒤집힌다.

이 PR은 **동작 변경 0**이다. `WorkBriefsPage`에서는 import 문만 늘고, 렌더 트리와 props는 그대로다.
diff는 크지만 리뷰는 "잘라내기와 붙여넣기가 맞는가" 하나로 끝난다. 여기에 개선을 섞으면
그 성질을 잃는다([R18](#42-위험-등록부-5단계)).

### 3.2 근거 번호 — 표시 전용 불변식

```ts
// citations/evidence-refs.ts
export function evidenceRefLabels(
  evidence: readonly WorkEvidence[],
): Map<string, string>;   // evidenceId → "E1"
```

`draft.evidence` 배열 순서대로 매번 다시 부여한다. 저장하지 않는다.

**불변식: 번호는 서버로 가지 않고 게시물에도 들어가지 않는다.**
초안 JSON(`BriefContent`)에는 `evidenceIds`만 있고 번호가 없다. 게시 미리보기와 Confluence 본문은
백엔드가 만들며 evidenceId와 URL을 쓴다. 프런트가 번호를 어딘가로 넘기기 시작하면
"근거 새로 고침"으로 배열이 바뀐 뒤 게시물의 번호가 어긋난다 — 1단계에서 없앤 종류의 거짓말이다.

번호가 바뀔 수 있다는 사실 자체는 문제가 아니다. 번호는 **지금 이 화면 안에서** 칩과 근거 목록을
맞춰 보기 위한 것이고, 화면을 벗어나면 의미를 잃도록 설계한 것이다.

### 3.3 칩

```
[E1] [E3] [E7] [+2]     근거 편집 (5)
```

- 칩은 `<button>`이다. `aria-label`에 근거 제목 전체를 넣어 스크린리더가 번호가 아니라 제목을 읽는다.
  시각적 툴팁은 CSS로 만든다 — `title` 속성은 키보드 포커스로 뜨지 않는다.
- 칩을 누르면 근거 목록의 해당 행으로 스크롤하고 포커스를 옮긴다([3.5](#35-역방향-보기--읽기-전용)의 반대 방향).
- 칩은 최대 6개까지 표시하고 나머지는 `+N`으로 접는다. `+N`을 누르면 팝오버가 열린다.
- **연결이 0개면 "근거 없음" 경고 톤 칩을 표시한다.** 칩만 보이는 UI에서 가장 쉬운 실수는
  "연결이 비어 있다"를 아무것도 없는 여백으로 보여 주는 것이다. 비어 있음은 명시적으로 그린다.
- excluded 근거가 연결돼 있으면 그 칩에 경고 톤을 준다. 접힌 상태에서도 보이도록 `+N`보다 앞에 정렬한다.

### 3.4 팝오버

**트리거**: "근거 편집 (N)" 버튼. `popovertarget`으로 팝오버를 가리킨다.

**구현**: 네이티브 `popover="auto"` 속성 + JS 위치 계산.

- 닫기(ESC · 바깥 클릭)와 최상위 레이어는 브라우저가 맡는다. 직접 쓰지 않는다.
- **CSS anchor positioning은 쓰지 않는다.** 지원 범위가 `popover`보다 좁다.
  `toggle` 이벤트에서 트리거의 `getBoundingClientRect()`로 좌표를 계산해 `position: fixed`로 놓는다.
- 뷰포트 하단을 넘치면 위로 뒤집는다. 열려 있는 동안 `scroll`·`resize`에 재계산한다
  (스크롤 시 닫는 쪽이 단순하지만, 편집 화면이 길어 스크롤 중 닫히면 작업이 끊긴다).
- **포커스는 직접 다룬다.** 열리면 검색 입력으로, 닫히면 트리거 버튼으로. `popover=auto`는
  light dismiss는 주지만 포커스 복귀는 보장하지 않는다.
- 지원 하한: Chrome 114+ · Safari 17+ · Firefox 125+. 별도 폴백 경로는 만들지 않되,
  기능 검사(`'popover' in HTMLElement.prototype`)가 실패하면 같은 마크업을 **인라인으로 펼친 채** 렌더한다.
  두 번째 코드 경로가 아니라 CSS 클래스 하나 차이이므로 테스트가 두 배가 되지 않는다([R20](#42-위험-등록부-5단계)).

**내용**

1. 검색 입력. 대상은 근거 제목 · provider · sourceId. 대소문자 무시. 열 때마다 초기화한다.
2. included 근거 체크박스 목록. 체크하면 **즉시** `onChange`가 나가고 뒤의 칩이 바뀐다.
3. `AI가 제외한 근거 N건 보기` 펼침. 펼치면 excluded 근거가 `aiExclusionReason`과 함께 나오고
   선택할 수 있다. 원문 본문은 여전히 표시하지 않는다(P2-1 결정 유지).
4. 하단에 "닫기"만. 적용/취소 버튼은 없다 — 바깥 클릭 닫기와 취소가 같은 제스처로 읽혀 충돌한다.

`CitationListEditor`가 새 항목을 만들 때 excluded를 기본값에서 빼는 현재 동작은 유지한다.

### 3.5 역방향 보기 — 읽기 전용

```ts
// citations/evidence-usage.ts
export type EvidenceUsage = { section: string; index: number }[];
export function evidenceUsage(content: BriefContent): Map<string, EvidenceUsage>;
```

`EvidenceList`의 각 근거 행에 `요구사항 2 · 완료기준 1 · 하위작업 1`처럼 요약을 붙인다.
클릭하면 해당 항목으로 스크롤한다.

- **읽기 전용이다.** 연결 해제는 팝오버 한 곳으로만 유지한다. 같은 상태를 바꾸는 입구가 두 개면
  어느 쪽이 진실인지 다시 헷갈린다.
- 사용처가 0건이면 "사용되지 않음" 배지를 붙인다. 근거를 골랐는데 어디에도 안 쓰인 상태는
  지금은 아무 데도 드러나지 않는다.
- `childTasks`는 `selected` 여부와 무관하게 센다. 선택은 게시 승인의 문제이지 인용의 문제가 아니다.
- 집계는 `useMemo`로 `content` 참조에 묶는다. 근거 15 × 항목 40이면 600회 순회이므로
  타이핑마다 돌아도 되지만, 메모하지 않을 이유도 없다.

### 3.6 작업 분해 (PR 단위)

| PR | 내용 | 검증 |
| --- | --- | --- |
| **4-A** | `sourceJiraKeys` 필터 + `AssignedIssueList` 자체 조회 | [2.4](#24-배포-순서와-롤백) 순서 준수. 스코프 회귀 테스트([R21](#41-위험-등록부-4단계-갭)) |
| **5-A** | 인용 컴포넌트를 `citations/`로 **순수 이동** | 화면 diff 0. 기존 spec 전부 통과 |
| **5-B** | `design-system`에 팝오버 프리미티브 + spec | 열기·ESC·바깥 클릭·포커스 복귀·위치 뒤집기 |
| **5-C** | `evidence-refs.ts` · `evidence-usage.ts` 순수 함수 + spec | 번호 부여, 검색 필터, 사용처 집계 |
| **5-D** | 칩 + 팝오버로 `CitationEditor` 교체 | 아래 완료 기준 |
| **5-E** | `EvidenceList` 역방향 보기 | 아래 완료 기준 |
| **5-F** | design-qa 프리뷰 픽스처(근거 15 × 요구사항 10) | `/dev/briefs-preview`에서 눈으로 확인 |

4-A는 나머지와 독립이다. 5-A가 먼저 들어가야 5-B·5-C가 병렬로 가고, 5-D는 셋 다에 의존한다.
5-F의 픽스처는 5-D 리뷰에 필요하므로 5-D보다 먼저 올려도 된다.

`work-briefs.preview.ts`의 `WORK_BRIEF_PREVIEW_EVIDENCE`(26행)를 15건으로 늘리고,
그중 3건을 `aiStatus: "excluded"`로, 1건을 어느 항목에도 연결되지 않은 상태로 둔다.
`/brief-drafts?` 분기(386행)에 `sourceJiraKeys` 파라미터를 받는 처리도 같이 넣는다.

### 3.7 완료 기준 / 검증

- 근거 15개 · 요구사항 10개 픽스처에서 **팝오버가 닫힌 상태의 화면에 체크박스가 0개**다.
  요구사항 섹션의 세로 길이가 기존의 절반 이하다.
- 키보드만으로 전체가 된다: Tab으로 "근거 편집"에 도달 → Enter로 열림 → 포커스가 검색 입력에 있음 →
  Tab·Space로 체크 → ESC로 닫히고 포커스가 트리거 버튼으로 **돌아온다**.
- 스크린리더가 칩을 읽을 때 "E3"이 아니라 근거 제목을 읽는다.
- excluded 근거는 기본 목록에 없고, 펼치면 `aiExclusionReason`과 함께 선택할 수 있다.
- 연결이 0개인 항목은 여백이 아니라 "근거 없음" 칩으로 보인다.
- 어느 항목에도 쓰이지 않은 근거가 `EvidenceList`에서 "사용되지 않음"으로 식별된다.
- "근거 새로 고침"으로 근거 배열이 바뀌면 번호가 다시 매겨지고, **저장 요청 본문과 게시 미리보기에
  "E1" 같은 문자열이 존재하지 않는다**(응답·요청 JSON을 문자열로 훑어 단언).
- `popover` 미지원 환경(기능 검사를 강제로 false로 둔 테스트)에서 근거 편집이 여전히 가능하다.
- 5-A 이후 `WorkBriefsPage.tsx`가 1,500행 아래로 내려간다.

### 3.8 구현 결과 (2026-08-06)

5-A~5-F에 5-G를 더해 모두 넣었다. 계획과 다르게 간 것과, 아직 열려 있는 것을 적는다.

| 완료 기준 | 결과 |
| --- | --- |
| 닫힌 화면에 체크박스 0개 | **성립.** `CitationEditor`가 팝오버 밖에 렌더하는 것은 칩과 트리거뿐이다 |
| 키보드 전 구간 + 포커스 복귀 | **구현했으나 자동 검증은 없다.** 프런트 테스트 러너가 `node --test`(DOM 없음)라 React 렌더 테스트를 붙일 수 없다. 위치 계산·지원 검사는 `popover-position.spec.ts`가 덮고, 포커스 시나리오는 `/dev/briefs-preview`에서 손으로 확인해야 한다 |
| 스크린리더가 제목을 읽는다 | **성립.** 칩의 `aria-label`이 근거 제목이고, 번호는 시각 텍스트로만 남는다 |
| excluded 기본 숨김 + 사유와 함께 선택 | **성립.** 팝오버 안 `<details>`, 레이블에 건수 |
| 연결 0개 → "근거 없음" 칩 | **성립.** 프리뷰 픽스처의 완료 기준 3번이 이 상태다 |
| 미사용 근거 → "사용되지 않음" | **성립.** 픽스처의 `jira:PROJ-238`이 이 상태다 |
| 저장·게시 경로에 `E\d+` 부재 | **성립.** `evidence-refs.boundary.spec.ts`가 페이로드를 만드는 모듈이 `evidence-refs`를 import하지 못하게 막는다 |
| `popover` 미지원 환경에서 편집 가능 | **성립.** `Popover`의 `supported` prop으로 검사 결과를 주입할 수 있고, 미지원이면 같은 패널이 흐름 안에 펼쳐진 채 렌더된다 |
| 5-A 이후 `WorkBriefsPage.tsx` < 1,500행 | **성립: 1,316행.** 다만 5-A만으로는 1,666행이었고, 계획이 열거한 다섯 개는 인용 컴포넌트뿐이라 그 이상 줄일 수 없었다. 아래 5-G에서 나머지를 분리해 기준을 채웠다 |

**5-G — 남은 분리 (계획에 없던 PR).** 5-A는 [R27](#42-위험-등록부-5단계) 때문에 인용 컴포넌트만
옮기는 PR이었고, 문서가 "개선은 5-D 이후 별도 PR"로 허용한 자리가 여기다. 동작 변경은 0이다.

| 옮긴 것 | 새 위치 | 왜 여기인가 |
| --- | --- | --- |
| `ConnectionSummary` | `ConnectionSummary.tsx` | — |
| `ConnectionSnapshot`·`PROVIDER_ORDER`·`toConnectionSnapshot`·`connectionsNeedingAction` | `connection-snapshot.ts` | 순수 함수라 spec을 붙였다. "응답이 배열이 아니면 unavailable"과 "loading 중에는 아무것도 요구하지 않는다"는 지금까지 검증된 적이 없다 |
| `EvidenceWorkspaceGroup` + `recommendationLabel` | `EvidenceWorkspaceGroup.tsx` | `recommendationLabel`은 이 컴포넌트에서만 쓴다 |
| `ReadinessPanel` | `ReadinessPanel.tsx` | — |
| 준비성 문구 4종 | `readiness-copy.ts` | 기존 `*-copy.ts` 관례를 따른다 |
| `RegenerateDialog` + `RegeneratePrompt` | `RegenerateDialog.tsx` | 타입이 다이얼로그의 계약이라 같이 옮겼다 |
| `publicationPhaseLabel` | `publication-copy.ts` | 이미 있던 게시 문구 모듈이다. 새 파일을 만들 이유가 없다 |

`createIdempotencyKey`는 페이지에 남겼다 — 게시 요청을 만드는 쪽의 로직이고, 문구도 컴포넌트도
아니라 옮길 곳이 마땅치 않다.

계획에 없던 추가는 둘이다.

- **`citations/citation-anchors.ts`** — 칩 → 근거 행, 사용처 → 항목의 양방향 스크롤은
  컴포넌트 경계를 넘으므로 ref가 아니라 DOM id로 이었다. 모르는 섹션에는 `null`을 돌려
  링크를 만들지 않는다(잘못된 곳으로 보내는 것보다 낫다).
- **`Popover`의 `extraTrigger`** — `+N` 칩도 같은 패널을 열어야 하는데([3.3](#33-칩)),
  버튼을 중첩할 수 없어 두 번째 트리거에 배선만 넘기는 구멍을 뒀다.
  네이티브 `popovertarget`을 그대로 쓰므로 여는 주체는 여전히 브라우저다.

**남은 일: `/dev/briefs-preview` 시각 확인.** 픽스처는 근거 15건(excluded 3, 미사용 1) ×
요구사항 10개로 갱신됐고, 요구사항 10번은 링크 7개라 `+N` 접힘과 excluded 칩 우선 정렬이
한 행에서 같이 보인다. 이 화면과 [design-qa.md](../design-qa.md) 갱신은 브라우저가 필요하다.

---

## 4. 위험 등록부

### 4.1 위험 등록부 (4단계 갭)

| ID | 위험 | 등급 | 발생 조건 | 탐지 | 대응 | 담당 |
| --- | --- | --- | --- | --- | --- | --- |
| R21 | `sourceJiraKeys` 필터가 소유자 스코프를 우회해 동료 초안의 존재가 배지로 드러난다 | **높음** | 필터 조건이 `where`를 대체하거나, 필터 경로가 별도 쿼리로 갈라지면서 `createdByUserId`를 빠뜨림 | 사용자 A의 초안이 있는 이슈 키로 사용자 B가 필터 조회 → 빈 목록 기대. 이 테스트를 필터 PR의 필수 항목으로 고정 | 기존 `listDrafts` 빌더에 `andWhere` 한 줄만 더한다. 필터용 쿼리를 새로 만들지 않는다 | 4-A |
| R22 | 배포 순서가 어긋나 담당 이슈 목록이 통째로 죽는다 | 중간 | `forbidNonWhitelisted`가 미지원 파라미터를 400으로 만든다. 프런트가 먼저 올라가거나 백엔드가 먼저 내려감 | 배포 직후 `/briefs` 스모크. 담당 이슈 패널이 unavailable 문구로 떨어지는지 | 백엔드 먼저 배포, 프런트 먼저 롤백([2.4](#24-배포-순서와-롤백)). 릴리스 노트에 명시 | 4-A |
| R23 | 배지 조회 실패가 담당 이슈 목록 전체를 못 쓰게 만든다 | 낮음 | 두 요청을 하나의 실패 상태로 묶으면 초안 조회 실패가 이슈 목록까지 지운다 | 두 번째 요청만 실패시키는 테스트 | 실패 상태를 분리한다. 배지 없이 렌더하고 409 문구가 최종 방어선 | 4-A |

### 4.2 위험 등록부 (5단계)

| ID | 위험 | 등급 | 발생 조건 | 탐지 | 대응 | 담당 |
| --- | --- | --- | --- | --- | --- | --- |
| R24 | 근거 번호가 저장 데이터나 게시물로 새어 나간다 | **높음** | "E1"을 텍스트에 넣어 미리보기를 만들거나, 편의로 `evidenceIds` 대신 번호를 전달 | 저장 요청 본문과 게시 미리보기 응답을 문자열로 훑어 `E\d+` 패턴 부재를 단언 | 번호는 렌더 시점에만 만들고 `BriefContent`에 넣지 않는다. 순수 함수를 별 모듈로 두어 서버 페이로드 조립 코드가 import하지 못하게 한다 | 5-C·5-D |
| R25 | 팝오버가 열린 채 스크롤·리사이즈되면 위치가 트리거에서 떨어진다 | 중간 | JS로 좌표를 한 번만 계산하고 끝냄 | 긴 편집 화면에서 팝오버를 열고 스크롤 | 열려 있는 동안 `scroll`·`resize` 재계산. 닫을 때 리스너 해제 | 5-B |
| R26 | 칩만 보여 연결이 비어 있는 항목을 못 알아챈다 | 중간 | 빈 연결을 빈 여백으로 렌더 | readiness가 `COVERAGE_MISSING`으로 잡지만 게시 직전에야 잡는다 | 연결 0개는 "근거 없음" 경고 칩으로 명시한다([3.3](#33-칩)) | 5-D |
| R27 | 순수 이동 PR(5-A)이 리팩터링으로 번진다 | 중간 | 1,900행 파일을 열면 정리하고 싶은 것이 계속 나온다 | PR diff에 잘라내기/붙여넣기 외의 변경이 있는지 | 5-A는 이동만. 개선은 5-D 이후 별도 PR. [R11](./work-copilot-usability-phase2-plan.md#61-등록부)과 같은 규칙 | 5-A |
| R28 | 팝오버 미지원 브라우저에서 근거 편집이 아예 불가능해진다 | 중간 | `display:none` + `:popover-open` 방식으로 짜면 미지원 브라우저에서 영영 열리지 않는다 | 기능 검사를 false로 고정한 테스트 | 기능 검사 실패 시 같은 마크업을 인라인으로 펼쳐 렌더한다([3.4](#34-팝오버)) | 5-B |
| R29 | excluded 근거가 기본 숨김이라 AI 판단을 아무도 검토하지 않는다 | 낮음 | 펼침이 닫힌 채로만 쓰인다 | — (구조적으로 예상되는 상태) | 펼침 레이블에 건수를 넣어 존재를 드러내고, `EvidenceList`에는 계속 배지와 사유를 노출한다(현재 동작 유지) | 5-D |
| R30 | 키보드·스크린리더 사용자가 근거 편집에 도달하지 못한다 | 중간 | 팝오버를 시각 중심으로 만들고 포커스를 브라우저에 맡김 | [3.7](#37-완료-기준--검증)의 키보드 시나리오를 완료 기준으로 고정 | 포커스 이동·복귀를 직접 구현하고 spec에 넣는다. 칩의 `aria-label`은 제목 | 5-B·5-D |

### 4.3 롤백 계획

| 대상 | 롤백 방법 | 데이터 영향 |
| --- | --- | --- |
| 4-A | **프런트 먼저**, 그다음 백엔드 | 없음. 마이그레이션·컬럼 추가가 없다 |
| 5-A~5-F | 프런트 이미지 되돌리기 | 없음. 저장 형식이 바뀌지 않는다 — `BriefContent`의 `evidenceIds`가 그대로다 |

5단계 전체가 데이터 영향 없는 프런트 변경이다. 되돌리면 체크박스 목록으로 돌아갈 뿐이고,
그동안 만들어진 초안은 어느 쪽 UI에서도 똑같이 읽힌다.

---

## 5. 백로그

이 문서와 앞선 계획에서 의도적으로 미룬 것들이다. 다루지 않는다는 뜻이지 없어도 된다는 뜻이 아니다.

| 항목 | 출처 | 왜 미뤘나 |
| --- | --- | --- |
| 게시 측 Confluence 중복 페이지 검사 | [6.2.3](./work-copilot-usability-phase2-plan.md#623-confluence-중복-페이지--409-차단만-잔여-위험-기록) | preview 경로에 외부 조회가 늘어난다. 관리자 DB 직접 수정·페이지 수동 삭제·다중 사용자 게시 경로의 중복은 여전히 열려 있다 |
| 팀 가시성 (동료 초안 표시) | [6.2.1](./work-copilot-usability-phase2-plan.md#621-목록-가시성--본인-초안만) | 소유자 표시 범위부터 다시 설계해야 하는 별도 작업 |
| 초안 버전 히스토리 테이블 | [3.3](./work-copilot-usability-phase2-plan.md#33-재생성-경로) | 재생성 되돌리기는 클라이언트 1회로 대체돼 있다 |
| 3단계 이전 초안의 인용 품질 | [R9](./work-copilot-usability-phase2-plan.md#61-등록부) | AI가 어떤 근거를 어디에 연결했는지 사후 복원이 불가능하다. 재생성으로만 갱신된다. **5단계 UI에서 이 초안들은 모든 항목이 모든 칩을 달고 나타난다** — 예상된 상태이므로 버그로 다루지 않는다 |
| 담당 이슈 20건 상한 표시 | [1.4](#14-계획에-영향을-주는-추가-발견) | 잘렸다는 사실이 응답에도 화면에도 없다. 검색이나 더보기가 필요해지면 그때 설계한다 |
| 담당 이슈 조회 재시도 버튼 | [`AssignedIssueList.tsx`](../frontend/src/features/work-briefs/AssignedIssueList.tsx) | 현재는 실패 시 문구만 남고 새로고침 외에 재시도 경로가 없다 |
| 근거 그룹·태그 | 5단계 논의 | 근거가 30건을 넘기 시작하면 검색만으로 부족해진다. 지금 규모에서는 이르다 |
| 다단계 승인 워크플로 | MVP 결정 | 원래부터 범위 밖 |
