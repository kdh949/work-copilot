# Work Copilot 설계 사례

## 프로젝트 개요

Work Copilot은 Jira 이슈와 Confluence 문서를 모아 출처가 연결된 업무 브리프를 만들고, 사용자가 내용을 확인한 뒤 외부 시스템에 반영하는 AI 애플리케이션입니다.

단순 요약 기능보다 다음 문제를 먼저 다뤘습니다.

- 사용자가 볼 수 없는 문서가 AI 입력이나 결과에 섞이지 않아야 합니다.
- 어떤 요구사항이 어느 문서에서 나왔는지 확인할 수 있어야 합니다.
- 문서가 바뀌면 이전 결과를 그대로 게시하지 않아야 합니다.
- AI 결과가 곧바로 Jira·Confluence를 변경하지 않아야 합니다.
- 네트워크 오류나 재시도 뒤에도 같은 항목을 중복 게시하지 않아야 합니다.

## 사용자가 겪는 문제

새 Jira 이슈를 맡은 사용자는 이슈 설명, 관련 Confluence 문서, 정책, 이전 논의를 여러 화면에서 다시 찾아야 합니다. 자료를 모은 뒤에도 요구사항과 의존성, 검증 기준을 직접 정리하고 하위 작업으로 옮겨야 합니다.

Work Copilot은 자료 탐색과 초안 작성을 줄이되, 원문 권한과 출처, 최신성, 외부 변경의 책임은 기존 업무 체계 안에 남기도록 설계했습니다.

## 내가 맡은 범위

개인 프로젝트로 다음 범위를 설계하고 구현했습니다.

- React 기반 업무 화면
- NestJS API/BFF와 PostgreSQL 데이터 모델
- FastAPI AI Service와 OpenAI 연동
- Keycloak 서비스 로그인과 사용자별 Atlassian OAuth 연결
- DLP·PII 처리와 Evidence·Citation 모델
- Draft, Readiness, Publication 상태와 실패 처리
- 자동 테스트, Docker Compose와 단일 서버 배포

## 전체 처리 흐름

```text
Jira 이슈 선택
  → 현재 사용자의 OAuth로 Jira·Confluence 조회
  → 필요한 근거 선택
  → DLP·PII 처리
  → Evidence ID가 연결된 브리프 생성
  → Citation·필수 항목·차단 의존성·Version 점검
  → 사용자 검토와 승인
  → 멱등 게시와 실패 단계 재처리
```

## 가장 중요한 설계 판단

### 1. 전역 RAG 대신 요청 시점의 사용자 권한으로 조회

#### 문제

Jira·Confluence 원문을 하나의 중앙 인덱스에 모으면 검색은 빨라질 수 있지만, 사용자마다 다른 문서 권한과 원문 Version을 결과에 정확히 반영하기 어렵습니다. 이전에 볼 수 있었던 문서가 계속 검색되거나, 다른 사용자의 문서가 잘못 섞이는 경로도 생길 수 있습니다.

#### 판단

업무 브리프를 만들 때마다 현재 사용자의 Atlassian OAuth로 원천 시스템을 조회하도록 했습니다. 서비스 로그인과 원문 접근 권한도 분리했습니다.

- Keycloak: Work Copilot 로그인 세션
- Atlassian OAuth: 해당 사용자가 Jira·Confluence에서 실제로 가진 조회 권한

#### 구현

Evidence에 다음 정보를 연결했습니다.

- Provider와 원문 ID
- 원문 URL
- 원문 Version
- DLP를 통과한 최소 발췌
- 브리프 항목과의 Citation 관계

권한이 사라지거나 Version이 바뀌면 기존 결과를 다시 검토하도록 상태를 변경합니다.

#### 결과

검색 결과를 유사도만으로 판단하지 않고, 사용자가 볼 수 있는 원문과 현재 Version이라는 제품 조건까지 포함했습니다.

### 2. 생성과 외부 변경을 분리

#### 문제

AI가 만든 초안을 즉시 외부 시스템에 게시하면 잘못된 요구사항, 오래된 근거 또는 민감정보가 Jira·Confluence에 남을 수 있습니다. 재시도 중 같은 페이지나 하위 작업이 두 번 생성될 수도 있습니다.

#### 판단

생성, 준비 상태 확인, 게시를 서로 다른 단계로 분리했습니다.

```text
Draft → Readiness → User Approval → Publication
```

#### 구현

- Citation, 필수 필드, 차단 의존성과 Evidence Version을 게시 전에 확인
- 외부 변경 전에 사용자의 명시적 승인 요구
- Idempotency-Key와 게시 단계 상태 저장
- 이미 성공한 단계는 재시도에서 건너뜀
- 실패한 단계만 다시 실행

#### 결과

AI 결과를 바로 실행하는 기능이 아니라, 사람이 확인하고 책임질 수 있는 업무 과정 안에 AI를 연결했습니다.

### 3. 원문 보관을 최소화

Jira·Confluence 원문 전체를 장기 보관하지 않습니다. AI 서비스에는 DLP를 통과한 최소 발췌만 전달하고, 원문 발췌가 필요한 경우에만 암호화해 최대 24시간 보관합니다. 장기 보관 대상은 마스킹된 브리프와 근거 식별자·Version입니다.

## 실패 시나리오

| 상황 | 처리 |
| --- | --- |
| 사용자가 문서 권한을 잃음 | 해당 Evidence를 유효한 근거로 사용하지 않고 재검토 상태로 전환 |
| 원문 Version이 바뀜 | 기존 브리프의 Freshness를 무효화하고 게시 차단 |
| DLP가 민감정보를 감지함 | AI 입력 또는 외부 게시 전 차단 |
| 같은 게시 요청이 다시 들어옴 | Idempotency-Key와 단계 상태로 중복 실행 방지 |
| 게시 중 일부 단계만 실패함 | 성공한 단계는 유지하고 실패 단계부터 재처리 |
| 새로고침·동시 편집이 발생함 | Draft Version과 서버 상태를 다시 확인 |

## 검증

검증 기준: `main@08d2e3e` · 2026-08-03

| 영역 | 기록 |
| --- | --- |
| Node | 64개 Suite, 178개 Test |
| FastAPI AI Service | 26개 Test |
| 제품 시나리오 | 권한 차이, DLP, Citation, Version 변경, 중복 요청, 부분 실패 |

자동 테스트 개수는 RAG 답변 품질을 직접 의미하지 않습니다. Retrieval, Citation과 DLP의 정량 평가 방식은 [평가 기준](evaluation.md)에 별도로 정리했습니다.

## 관련 자료

- [저장소 README](../README.md)
- [AI·제품 평가 기준](evaluation.md)
- [RAG 평가 실행 안내](../backend/ai-service/evals/README.md)
- [Ubuntu 24.04 배포 안내](ubuntu-24.04-deployment.md)
- [포트폴리오 상세 페이지](https://dhkim.cloud/work-copilot)
