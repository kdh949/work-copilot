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

## 최종 판정

- P0: 0
- P1: 0
- P2: 0
- final result: passed
