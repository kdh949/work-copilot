# Work Copilot 게시 운영 절차

이 문서는 게시 saga가 중단되거나 외부 응답이 유실됐을 때의 복구 순서를
정의한다. 실제 Jira·Confluence 쓰기는 기본적으로 `mock`이며, 검증된 Data
Center OAuth2 계약과 운영 승인 없이 `real` 모드를 켜지 않는다. 계약 절차는
[`atlassian-dc-oauth-contract.md`](./atlassian-dc-oauth-contract.md)에 있다.

## 정상 재승인

`NEEDS_REVIEW`는 바로 retry할 수 있는 상태가 아니다.

1. 화면에서 해당 phase의 **미리보기 다시 열기**를 선택한다.
2. 새 미리보기의 draft version, 대상, 본문을 확인한다.
3. 체크박스를 다시 선택하고 **다시 승인 및 실행**을 누른다.
4. 서버가 새 `approvalRevision`과 preview hash를 검증한 뒤 해당 phase의
   `NEEDS_REVIEW` step만 `PENDING`으로 열고 실행 token을 발급한다.

이전 화면의 preview와 approval revision을 재전송하면 provider를 호출하지
않는다. 두 브라우저가 동시에 새 승인을 보내도 조건부 상태 변경과 claim
때문에 한 실행만 외부 작업을 수행한다.

## publication이 step 없이 남은 경우

`brief_publications`가 `PENDING`인데 `publication_steps`가 0개이면 초기
transaction이 완료되지 않은 비정상 상태다. 같은 draft version의 최신
미리보기를 다시 열고 승인해 publish 요청을 한 번 보낸다. 서버는 누락된
`confluence_page` step을 `ON CONFLICT DO NOTHING` 방식으로 복구한 뒤
정상 claim한다.

앞 단계가 없는 상태에서 Jira 또는 child-task step만 존재하면 자동 완료로
처리하지 않는다. 응답의 `NEEDS_REVIEW` 또는 `PUBLICATION_STEPS_INVALID`를
관찰하고 데이터를 먼저 조사한다.

## ambiguous 외부 응답

생성 API가 빈 2xx body, ID 없는 body, timeout 또는 malformed body를 반환하면
외부 객체가 만들어졌을 가능성이 있다. 이 경우 같은 요청에서 create를 다시
보내지 않는다.

create 요청이 전송된 뒤 5xx가 오는 경우도 같다. 4xx는 확정 거절이지만 5xx는
쓰기가 이미 반영된 뒤에 반환될 수 있으므로 "없음"으로 보지 않는다.

- Confluence page title marker, Jira remote-link global ID, comment marker,
  child-task property를 먼저 reconciliation한다.
- 객체를 찾으면 해당 step을 성공으로 복구한다.
- 검색 범위를 다 확인하지 못하면 non-retryable
  `PUBLICATION_RECONCILIATION_INDETERMINATE`로 남기고 step은 `NEEDS_REVIEW`가
  된다. 자동 retry는 create를 다시 보내지 않는다.
- 특히 child task는 JQL search index로 조회하므로 방금 만든 이슈가 즉시
  보이지 않을 수 있다. 여기서 `absent`를 믿고 재생성하면 이슈가 중복된다.
- 운영자가 외부 목록을 확인한 뒤 "정상 재승인" 절차로만 다시 실행한다.

운영자는 ambiguous 오류 뒤에 외부 목록을 확인하지 않은 채 수동 create를
수행하지 않는다. provider access 제한, pagination 예산 소진, timeout은
“없음”이 아니다.

## lease와 stale worker

step은 execution token과 만료 시각을 함께 가진다. 실행 중에는 heartbeat가
lease를 연장하고, heartbeat·성공·실패 저장은 모두 step ID와 token을
조건으로 한다. token이 바뀐 worker의 최종 저장은 영향을 주지 않는다.

stale worker가 provider write를 마친 뒤 token을 잃었을 수 있으므로, 다음
실행은 반드시 operation marker를 다시 조회한다. `providerObjectId`가 없는
RUNNING step은 lease 만료 여부와 마지막 시도 시각을 확인하고, 외부 객체
중복 여부가 확인된 뒤에만 복구한다.

이 규칙은 코드에서 강제된다. claim은 `PENDING`/`FAILED` 인수와 만료된
`RUNNING` 인수를 서로 다른 조건부 update로 분리하고, 후자를 가져간 실행은
provider를 호출하지 않는다. 중단된 worker가 write를 이미 보냈는지 알 수
없기 때문에 해당 step은 `PUBLICATION_RECONCILIATION_INDETERMINATE`와 함께
`NEEDS_REVIEW`로 두고, 운영자가 외부 상태를 확인한 뒤 재승인해야 실행된다.

## 배포와 관찰

새 migration은 기존 migration을 수정하지 않고 뒤에 추가한다. 배포 전후에
다음을 확인한다.

- `approvalRevision`, `reviewRevision`, `approvedRevision`은 숫자 상태만
  저장하며 token이나 provider 응답 원문을 로그·DB에 저장하지 않는다.
- `executionToken`과 lease expiry가 오래된 RUNNING step에 남아 있지 않다.
- `PUBLICATION_RECONCILIATION_INDETERMINATE` 발생률과 단계별 실패 metric을
  확인한다.
- `PUBLICATION_WRITE_MODE=real`은 검증된 OAuth2 contract가 없으면 시작되지
  않는다.

실제 Data Center contract suite는 자격 증명과 전용 staging 대상이 있을 때만
별도로 실행한다. 일반 CI와 unit/integration test는 실제 Jira·Confluence에
쓰지 않는다.

## 삭제한 초안의 보존

초안 삭제는 소프트 삭제다. `deletedAt`이 찍히면 이슈 점유만 풀리고 행은
남는다. 게시 이력은 이렇게 보존되며, 게시 진행 중이거나 외부 쓰기가 이미
발생한 초안은 애초에 삭제가 `409`로 거절된다.

소프트 삭제된 초안은 `WORK_BRIEF_DRAFT_RETENTION_DAYS`(기본 90) 이후
하드 삭제된다. **이 시점을 지나면 복구할 수 없다.** 사용자에게는 삭제 확인
화면에서 "복구는 관리자 문의로만 가능하며 90일이 지나면 불가능하다"고
안내하므로, 이 값을 줄이면 관리자가 제공할 수 있는 복구 창도 같이 줄어든다.

보존 job은 두 곳에서 돈다.

- API 프로세스의 시간당 타이머. `CleanupHealthService`에 결과를 보고하므로
  `admin/work-copilot/health`의 `cleanup.jobs[deleted_brief_drafts]`에서
  마지막 성공 시각을 볼 수 있다.
- `cleanup` 컨테이너의 `cleanup-main`. API가 내려가 있어도 보존이 지켜진다.

대부분의 실행은 `deletedCount: 0`이며 이것이 정상이다. 실패로 보지 않는다.

### `skippedCount`가 0이 아닐 때

job은 `executionMode = 'real'`이고 `confluenceContentId`가 있는 publication을
가진 초안을 **건너뛰고 센다**. `brief_publications`가 `ON DELETE RESTRICT`라
그냥 지우면 FK 위반으로 실행 전체가 실패하기 때문이기도 하지만, 더 중요한
이유는 그런 초안이 정상 경로로는 소프트 삭제될 수 없다는 점이다. 삭제 API가
`DRAFT_HAS_PUBLICATION`으로 막는다.

따라서 `skippedCount > 0`은 DB를 직접 수정하는 등 애플리케이션 밖에서 행이
바뀌었다는 뜻이고, health가 해당 job을 `degraded`로 표시한다. 조용히 지우면
안 된다 — 그 초안의 이슈로 새 브리프를 만들어 게시하면 Confluence 페이지가
중복 생성된다. 대상 초안을 찾아 Confluence 페이지 존재 여부를 먼저 확인하고,
어떤 경로로 삭제 표시가 됐는지 확인한 뒤에 처리한다.
