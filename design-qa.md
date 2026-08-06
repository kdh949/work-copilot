# Design QA — 업무 브리프 근거 선택

## 대상

- Source visual: `/Users/donghyunkim/WebstormProjects/dh-board-backend/design-qa-assets/work-brief-reference-1440x1024.png`
- Implementation screenshot: `/Users/donghyunkim/WebstormProjects/dh-board-backend/design-qa-assets/work-brief-implementation-1440x1024.png`
- Combined comparison: `/Users/donghyunkim/WebstormProjects/dh-board-backend/design-qa-assets/work-brief-comparison-final.png`
- Mobile screenshot: `/Users/donghyunkim/WebstormProjects/dh-board-backend/design-qa-assets/work-brief-mobile-390x844.png`
- URL: `http://127.0.0.1:5174/?preview=work-brief`

## 캡처 조건

- Desktop viewport: 1440 × 1024
- Source dimensions: 1487 × 1058, 비교 입력에서 1440 × 1024로 정규화
- Implementation dimensions: 1440 × 1024
- Mobile viewport: 390 × 844
- State: `PROJ-284`, Jira 3건 + Confluence 3건, 5건 선택, 전체 문서, 최근 30일

## 비교 근거

- 원본과 구현 캡처를 좌우로 합친 `work-brief-comparison-final.png`를 동일 입력으로 검토했다.
- 상단 내비게이션 높이, 3열 구조, 좌측 소스 필터, 중앙 근거 행 밀도, 우측 선택 목록과 하단 CTA 위치를 비교했다.
- 최종 구현 열 너비는 292px / 804px / 344px이며, 1440px에서 가로 오버플로가 없다.
- 390px에서 단일 열로 전환되며 문서 가로 오버플로가 없다.

## 기능 검증

- 검색: `PG` 입력 시 2건으로 필터링됨.
- 문서 유형: Confluence 선택 시 Confluence 3건만 표시됨.
- 업데이트 기간: `updatedAt`이 제공된 근거는 선택한 최근 7/30/90일 범위로 필터링됨.
- 선택: 우측 항목 제거 시 5건 → 4건, 표에서 재선택 시 5건으로 복구됨.
- 생성: `브리프 생성` 클릭 시 편집 초안이 생성되고 `PROJ-284`가 표시됨.
- 브라우저 경고/오류: 없음.
- Build: passed.
- Lint: passed.

## 발견 사항과 수정 이력

1. P2 — 390px에서 프로필 영역이 헤더 아래로 넘쳤다. 모바일 구간에서 보조 헤더 액션을 숨기고 내비게이션을 가로 스크롤 영역으로 유지했다. 해결됨.
2. P2 — 작은 화면에서 근거 표의 보조 열이 과도하게 좁아졌다. 업데이트/상태 열을 접고 핵심 제목과 선택 컨트롤을 유지했다. 해결됨.
3. P0 (후속) — 1번 수정이 `.header-actions`를 통째로 숨겨 **760px 이하에서 로그아웃이 불가능**했다. 프로필 메뉴가 그 안에 있었기 때문이다. 넘침의 실제 원인은 `@media (max-width: 820px)`가 고정 높이 헤더를 `flex-direction: column`으로 바꾼 것이었다. 해당 선언을 제거해 헤더를 모든 폭에서 행 레이아웃으로 유지하고, 액션을 다시 노출했다. 해결됨.

## 회귀 확인 (2026-08-05, feature/ui-trust-fixes)

- 390 / 800 / 1440px에서 헤더 높이 64px 유지, 가로 오버플로 없음(`body.scrollWidth === innerWidth`).
- 390px에서 프로필 드롭다운과 로그아웃 버튼이 뷰포트 안에 완전히 들어옴(로그아웃 x=131, right=357).
- 동작하지 않던 도움말·알림 아이콘과 근거 행 `⋮` 메뉴를 제거했고, 상시 표시되던 알림 뱃지도 함께 제거했다.
- 근거 행의 가짜 날짜(`07.29` 등)와 자동 "확인 필요" 상태를 제거했다. 백엔드 `NormalizedEvidence`는 `state`·`updatedAt`을 제공하지 않으므로 이 값들은 실제 사용에서 전부 허구였다.
- 브라우저 경고/오류: 없음. Lint: passed. Build: passed. Backend test: 77 suites / 297 tests passed.

## 최종 판정

- P0: 0
- P1: 0
- P2: 0
- final result: passed
