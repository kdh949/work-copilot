# Work Copilot 최종 인수 체크리스트

기준 계획: `docs/jira-confluence-work-copilot-implementation-plan.md`
점검일: 2026-08-02
코드 기준: `fix/jira-confluence-copilot-acceptance`의 `a6adbae` 이후 작업 트리

## 판정 기호

- `[x]` 로컬 코드와 자동 테스트로 확인됨
- `[~]` 안전한 코드 경계는 있으나 계획의 전부 또는 운영 증명이 아직 없음
- `[ ]` 실제 관리자·staging·승인이 있어야 확인할 수 있음
- `[-]` 계획에서 명시적으로 제외한 범위

## 최종 판정

| 범위 | 판정 | 근거 |
| --- | --- | --- |
| 로컬 기능 인수 | 조건부 통과 | build, 64개 unit suite/178 test, provider-mock e2e, AI DLP corpus, frontend lint/build, 실제 임시 PostgreSQL cleanup을 통과했다. |
| 보안 경계 | 조건부 통과 | 사용자 OAuth 분리, raw 원문 비영속 경계, DLP, citation, key rotation, mock-only publish가 코드·테스트에 있다. |
| 실제 파일럿 Go/No-Go | **No-Go** | 실제 Keycloak/Atlassian OAuth, ingress 증명, 독립 cleanup scheduler/alert, 자동 browser e2e, DC staging smoke, OpenAI ZDR 증명이 남아 있다. 저장된 OpenAI credential의 인증 진단도 HTTP 401로 실패했다. |
| 외부 쓰기 | 차단 유지 | 실제 Jira/Confluence write adapter는 없고 mock gateway만 사용한다. 사용자 승인도 없다. |

## 1. 목적과 확정된 결정

- [x] Jira·Confluence는 현재 사용자의 연결 토큰으로만 읽고, 브리프 생성 전 근거를 다시 수집한다. `work-items/*`, `work-briefs/*` 단위 테스트로 확인했다.
- [x] 승인 전 외부 write가 발생하지 않는다. `MockPublicationWriteGateway`와 publication boundary test가 mock mode만 허용한다.
- [x] Keycloak 로그인 세션과 Jira·Confluence OAuth 연결을 별도 엔터티·서비스로 분리했다.
- [x] 활성 연동 프로필은 하나만 허용한다. profile activate transaction과 partial unique index를 테스트했다.
- [x] Jira·Confluence 원문은 `Post`/`wiki_documents`/`wiki_document_chunks`/pgvector 경로로 보내지 않는다. persistence boundary test와 AI source test가 확인한다.
- [x] 기존 wiki RAG와 `work_brief` FastAPI 모듈을 분리했고, work brief 요청에는 vector indexing·web/MCP tool이 없다.
- [x] secret 차단, 한국어 PII 마스킹, AI 출력 재검사를 구현했다.
- [~] 원문 발췌는 AES-256-GCM과 24시간 read filter·delete로 처리한다. 독립 실행 명령 `cleanup:run:compiled`은 추가하고 실제 임시 DB의 두 만료 테이블 삭제를 확인했지만, 운영 scheduler/70분 경보는 아직 증명되지 않았다.
- [x] webhook은 source ID/version/event time/fingerprint만 처리하고 draft/publication을 `REVIEW_REQUIRED`로 바꾼다. 원문 재조회·AI·write를 하지 않는다.
- [x] readiness는 coverage, createmeta, 1-hop blocker, freshness를 읽기 전용으로 평가하고 publish gate에 연결한다.
- [-] 작성자·리뷰어·승인자 다단계 approval은 계획상 MVP 제외이며 구현하지 않는다.

## 2. 기존 코드베이스 경계 전환

| 체크 | 상태 | 확인 근거 |
| --- | --- | --- |
| 자체 password/JWT에서 Keycloak OIDC BFF session으로 전환 | [x] | `auth/oidc`, `SessionAuthGuard`, OIDC/session specs |
| `keycloakSubject`로 계정 매핑, Keycloak admin claim 사용 | [x] | user mapping 및 `WorkCopilotAdminGuard` specs |
| TypeORM `synchronize: false`, migration runner 사용 | [x] | `database.config.ts`, migration specs |
| credentials 포함 fetch, Origin allowlist, CSRF/Origin 검증 | [x] | `App.tsx`, `main.ts`, origin/CSRF specs |
| 기존 Post→AI→RAG는 wiki 전용 유지 | [x] | work-item/work-brief persistence boundary specs |
| Jira·Confluence를 RAG에 재사용하지 않음 | [x] | P1/P2 persistence boundary specs |
| FastAPI `work_brief`를 wiki RAG에서 분리 | [x] | `backend/ai-service/work_brief/*`, AI test corpus |

### 2.1 확장 우선순위

- [x] webhook 기반 재검토 inbox는 P3-1 shadow/manual-refresh 경계로 반영했다.
- [x] 통합 readiness는 P2-1a로 반영했다.
- [-] 버전 고정 다단계 approval은 보류 범위로 유지했다.
- [-] 중복 이슈 탐지·release handoff pack은 별도 조사 범위로 유지했다.

## 3. 목표 아키텍처 경계

- [x] 브라우저는 bearer access token을 보관하지 않고 session cookie/CSRF header를 사용한다.
- [x] Keycloak OIDC Code + PKCE, Jira/Confluence 사용자별 OAuth 호출 경로를 분리했다.
- [x] DLP를 통과한 최소 발췌만 내부 AI API로 보내고 OpenAI 요청은 `store: false`·tool-free·strict JSON schema다.
- [x] wiki RAG는 기존 사내 wiki에만 연결되어 있고 Jira/Confluence source는 연결하지 않는다.
- [x] webhook은 사용자 권한 확인을 대체하지 않으며, refresh 시에만 사용자 OAuth로 current version/access를 확인한다.

## 4. 구현 전제와 관리자 체크

### 4.1 Atlassian 관리자 사전 점검

- [ ] Jira Incoming Application Link 등록, 최소 `READ`/필요 시 `WRITE` scope와 `READ_ALL` 미사용을 실제 DC 버전에서 확인한다.
- [ ] Confluence Incoming Application Link 등록과 DC 7.17 이상 Provider API 지원 여부를 확인한다.
- [ ] Jira/Confluence redirect URI를 실제 API host로 등록한다.
- [ ] base URL, client ID/secret, 허용 project/space, parent page ID, child task template을 관리자 UI에 입력한다.
- [ ] 같은 Jira issue를 보되 Confluence 권한이 다른 두 테스트 사용자를 만든다.
- [ ] Jira child task issue type, required custom field, 설명 format을 `createmeta`로 확인한다.
- [ ] Jira `EXCLUDE_BODY`/`excludeBody`, 허용 project JQL, Confluence webhook secret 전달 방식을 실제 target version에서 확인한다.
- [ ] HTTPS + profile route secret + CIDR allowlist 또는 mTLS ingress 경계를 staging에서 증명한다.
- [ ] 실제 Jira/Confluence OAuth 승인, refresh, read와 허용 범위 밖 project/space 거절을 두 사용자로 확인한다.

### 4.2 Keycloak 및 계정 전환 사전 점검

- [ ] realm issuer/JWKS/authorization/token endpoint, client ID, redirect URI를 staging에 설정한다.
- [ ] `work-copilot-admin` claim이 ID token 또는 userinfo에 안정적으로 나타나는지 확인한다.
- [ ] `email_verified=true` 및 회사 도메인 allowlist를 만족하는 기존 계정 매핑 후보를 운영자가 검토한다.
- [ ] 매핑 실패 사용자의 신규 profile onboarding을 실제 Keycloak flow에서 확인하고 legacy password 우회가 없는지 점검한다.
- [ ] 일반 사용자와 admin의 실제 권한 차이를 staging에서 확인한다.

### 4.3 배포·보존 전제

- [x] 만료 발췌/event는 API read query에서 즉시 제외하고 purge 대상으로 삼는다.
- [x] cleanup health 기본 stale 임계값은 계획의 70분(4200초)으로 고정했다.
- [~] web 프로세스 timer와 별도로 `cleanup:run:compiled` 실행 경로를 구현했다. 실제 scheduler/cron을 Render 등에 배포하면 비용·운영 권한을 발생시키므로 이번 인수에서는 생성하지 않았다.
- [ ] 독립 cleanup job의 마지막 성공 시각·70분 경보를 실제 운영 monitor에서 증명한다.

## 5. 데이터 모델과 보존 정책

| 테이블/규칙 | 상태 | 확인 근거 또는 남은 일 |
| --- | --- | --- |
| UUID·timestamp·unique index 신규 테이블 | [x] | foundation 및 후속 migration static specs |
| `users`: Keycloak subject/identity/legacy migration, nullable password | [x] | foundation migration, user mapping specs |
| `auth_sessions`: hash-only session/CSRF, expiry/revocation | [x] | entity/session specs |
| `integration_profiles`: encrypted secrets, allowlist, one active profile | [x] | crypto/profile specs |
| `oauth_authorization_attempts`: state hash, encrypted PKCE verifier, 10분 single-use | [x] | OAuth service specs |
| `atlassian_oauth_connections`: encrypted token pair, status, refresh lock | [x] | OAuth connection/refresh specs |
| `work_brief_drafts`: masked brief/evidence metadata/version/freshness | [x] | entity/service/persistence specs |
| `transient_evidence_fragments`: encrypted fragment, expiry, no secret fragment | [x] | crypto/fragment specs |
| `source_change_events`: whitelist metadata + short TTL | [x] | parser/ingest specs |
| `readiness_assessments`: finding code/evidence only, read-only result | [x] | readiness specs |
| `brief_publications`/`publication_steps`: safe code·operation·retry state | [x] | publication specs |
| `security_audit_events`: actor/action/IDs/correlation, no raw values | [x] | safe-audit/persistence specs |
| blank DB migration up/down | [x] | 임시 PostgreSQL에서 네 migration을 적용하고 모두 revert한 뒤 `migration:show`가 전부 `[ ]`인 것을 확인했다. |
| existing DB rollback safety | [~] | synthetic Keycloak-only 사용자(`password IS NULL`)가 있는 DB에서 foundation down은 `WORK_COPILOT_LEGACY_PASSWORD_ROLLBACK_BLOCKED`로 destructive drop 전 차단된다. 실제 운영 DB 사본에는 권한 없이 실행하지 않았다. |

### 암호화·오류 보존 기준

- [x] profile/token encryption key와 transient-content key를 분리한다.
- [x] AES-256-GCM ciphertext/IV/tag/key version을 사용하고 secret column은 기본 select에서 제외한다. current/previous key를 읽고 profile secret·OAuth token·active transient fragment를 current key로 재암호화한다.
- [x] 안전한 오류 code/correlation 중심으로 처리하며 provider body, token, source text를 로그/audit에 기록하지 않는다.
- [~] `INTEGRATION_*`와 `TRANSIENT_CONTENT_*`의 current/previous key 환경변수는 example/Render secret declaration까지 반영했고 crypto 회귀 테스트를 통과했다. 실제 Render secret 입력·rotation cutover는 사용자 승인과 비밀값이 필요하다.

## 6. API 계약과 권한

| API 영역 | 상태 | 확인 근거/차이 |
| --- | --- | --- |
| OIDC login/callback/logout/me | [x] | controller·OIDC/session tests. 실제 IdP smoke는 미실시. |
| integrations authorize/callback/list/disconnect | [x] | user OAuth controller/service tests, safe status UI. |
| admin profile CRUD/activate/test | [x] | admin guard, crypto, SSRF/url policy, UI tests. |
| webhook ingress | [x] | stronger profile route `POST /webhooks/:profileId/:provider`; generic provider route 대신 route secret의 profile binding을 강제한다. |
| Jira context | [x] | documented `GET /work-items/jira/:issueKey/context`를 제공하며 이전 `issues/:issueKey` alias도 유지한다. |
| Confluence evidence | [~] | allowlisted space search와 selected-page re-read는 별도 API다. 계획의 Jira context 응답에 Confluence 목록을 한 번에 합치지는 않는다. |
| readiness | [~] | `GET /brief-drafts/:id/readiness`는 구현했다. 계획의 issue-key `POST /work-items/jira/:issueKey/readiness`는 별도 구현하지 않고 draft-scoped 평가로 제한했다. |
| brief draft CRUD/refresh/optimistic lock | [x] | citation validator, 409 conflict, refresh specs와 UI 흐름. |
| publish/publication/retry | [x] | approval/version/idempotency contract와 mock saga. 실제 provider write는 의도적으로 없다. |

- [x] 브라우저 변경 API는 BFF session/CSRF middleware를 통과하고, webhook은 별도 route secret/CIDR ingress 경계를 사용한다.
- [x] API DTO는 token, client secret, pre-DLP fragment를 반환하지 않는다.
- [x] `Idempotency-Key`와 draft version이 publish에 적용되고 stale draft는 409으로 막힌다.
- [x] fact-like AI content 및 사용자 편집 항목은 evidence ID citation validator를 통과해야 한다.

### 6.1 Freshness와 readiness 계약

- [x] webhook은 self `operationId` event를 freshness 전이 전에 무시한다.
- [x] refresh는 사용자 OAuth로 access/current version을 다시 확인하고 access loss이면 이전 title/fragment를 노출하지 않는다.
- [x] freshness 경고 또는 access loss draft는 publish gate에서 차단된다.
- [x] readiness는 자동 Jira write 없이 `COVERAGE_MISSING`, `CREATE_FIELD_MISSING`, `ACCESS_LIMITED_DEPENDENCY`, freshness codes를 반환한다.
- [x] inaccessible dependency는 key/title/body 없이 access-limited 상태만 표시·저장한다.

## 7. DLP·AI·권한 안전 설계

### 7.1 처리 순서

- [x] profile/user OAuth 및 project/space/parent guard를 먼저 적용한다.
- [x] NestJS에서 size limit과 API key/JWT/PEM/DB URI/`.env` secret blocker를 먼저 적용한다.
- [x] FastAPI에서 PII/custom-rule DLP를 적용하고 request-local placeholder map을 사용한다.
- [x] 필요한 raw fragment만 암호화 TTL store에 넣고 AI에는 masked input/evidence ID만 보낸다.
- [x] Responses API request는 `store: false`, no tools, system instruction, strict `text.format` JSON schema를 사용한다.
- [x] JSON/evidence ID validator와 output secret/PII re-scan을 통과한 결과만 draft로 만든다.
- [x] edit와 publish 직전에도 DLP/citation/freshness/readiness gate를 다시 적용한다.

### 7.2 분류별 조치

| 분류 | 상태 | 확인 근거 |
| --- | --- | --- |
| API key/JWT/PEM/DB URI/`.env`/OAuth-like secret 즉시 차단 | [x] | Nest/FastAPI secret fixtures가 AI call 전 실패하는 tests |
| 이메일·전화·주민번호·사업자번호 consistent placeholder | [x] | checksum 및 `[EMAIL_1]` 등 corpus |
| 운전면허·Luhn card·labelled account·labelled Korean address | [x] | high-confidence detector 및 false-positive regression |
| policy `CONFIDENTIAL`/`SECRET` custom block/mask | [~] | bounded literal-only runtime rules는 있다. 관리자 등록 UI/API, policy version increment, audit lifecycle은 없다. |
| 일반 업무 정보의 최소 발췌 | [x] | content bounds + transient evidence path |

### 7.3 Custom DLP rule 안전성

- [x] arbitrary regex는 허용하지 않고 2–128자 literal matcher만 사용한다.
- [x] rule name/classification/action/개수/control character를 server-side validation으로 제한한다.
- [x] invalid rule은 fail closed로 AI 요청 전에 거절한다.
- [~] 관리자 입력 화면, raw test-string 비보존 workflow, policy version increment, 변경 audit은 구현되지 않았다.

### 7.4 프롬프트 인젝션 방어

- [x] instruction/evidence는 untrusted quoted data이며 system instruction이 명령을 따르지 않도록 고정한다.
- [x] work-brief OpenAI request에는 browser/MCP/file/external-write tool이 없다.
- [x] output evidence ID는 요청한 ID 집합의 non-empty unique subset인지 서버가 검사한다.
- [x] model output은 직접 provider action을 실행하지 않으며 publish는 session/CSRF/approval/version/readiness를 다시 확인한다.

### OpenAI 계약 확인

- [x] 공식 OpenAI 문서 기준 Responses API `store:false`와 `text.format` + strict JSON schema를 유지한다.
- [x] `WORK_BRIEF_OPENAI_MODEL` override가 없으면 deployment `OPENAI_MODEL`을 사용한다.
- [ ] 실제 OpenAI work-brief smoke는 통과하지 않았다. 로컬에 설정된 credential로 `/v1/models` 인증만 최소 진단했으며 HTTP 401을 받았다. 키 값·응답 본문은 출력하거나 저장하지 않았고, 비용이 발생할 generation 재시도는 하지 않았다.
- [ ] 운영 OpenAI project의 ZDR/Modified Abuse Monitoring 승인·project setting은 관리자 증명이 필요하다. `store:false`만으로 ZDR이 보장되지는 않는다.

## 8. 승인형 publish saga와 복구

- [x] publish 전 draft lock/version, output DLP, freshness, readiness, explicit approval을 검증한다.
- [x] operation ID, publication step state, safe error code, retry state를 저장한다.
- [x] Confluence version conflict, Jira link/comment failure, child task partial failure는 `PARTIALLY_PUBLISHED`/`NEEDS_REVIEW` recovery 상태로 표현한다.
- [x] 같은 `Idempotency-Key` 재시도는 기존 publication을 반환하고 완료 step을 다시 실행하지 않는다.
- [x] UI는 mock mode와 external write 미수행을 명시한다.
- [ ] parent-page 제한, real Confluence version re-read/retry, remote link/comment/child task reconciliation은 actual provider adapter 및 사용자 승인 전에는 검증하지 않는다.

## 9. 작업 분해별 완료 기준

### P0-1 migration 및 보안 설정

- [x] migration runner와 `synchronize:false`를 적용했다.
- [x] users/session/profile/OAuth/draft/publication/audit schema migration이 있다.
- [x] Origin allowlist, correlation ID, safe exception mapping을 적용했다.
- [x] Render YAML에는 secret name만 두고 비밀값은 `sync:false`로 둔다.
- [x] unauthorized Origin/CSRF boundary는 automated specs로 검증했다.
- [~] blank DB 네 migration up/down은 실제 임시 PostgreSQL에서 통과했다. Keycloak-only synthetic user가 있는 existing-like DB는 down safety guard가 destructive rollback을 차단한다. 실제 운영 사본 검증은 승인 필요다.

### P0-2 Keycloak OIDC BFF

- [x] discovery, state/nonce/PKCE, code exchange, JWKS/issuer/audience/email verification 검증을 구현했다.
- [x] HttpOnly/Secure session, rotation, CSRF fetch flow를 구현했다.
- [x] verified email/domain 기반 one-time user mapping과 Keycloak admin claim guard를 구현했다.
- [x] localStorage Authorization과 legacy signup/login path를 copilot auth flow에서 제거했다.
- [ ] 실제 Keycloak claim/redirect/cookie browser behavior는 staging smoke가 필요하다.

### P0-3 integration profile admin

- [x] CRUD, active-profile transaction, scope allowlist, AES-GCM secret encryption을 구현했다.
- [x] admin UI는 secret을 configured boolean으로만 반환하고 재표시하지 않는다.
- [x] HTTPS/base URL policy, redirect policy, allowlist/parent validation으로 SSRF surface를 제한한다.
- [x] non-admin 403과 audit redaction을 unit test로 확인했다.
- [ ] 실제 discovery/parent accessibility test는 real provider가 필요하다.

### P1-1 user OAuth

- [x] Jira/Confluence authorize/callback, PKCE state, encrypted access/refresh token, disconnect를 구현했다.
- [x] refresh rotation은 advisory/row locking으로 경쟁 요청을 직렬화한다.
- [x] key rotation 중에는 current/previous key로 legacy token을 읽고, 아직 유효한 token을 읽는 즉시 current key ciphertext로 다시 저장한다.
- [x] API/UI는 connected/expired/reauthorization-required 같은 safe status만 보인다.
- [x] user A/B token isolation과 provider 401/403 safe conversion을 mock test로 확인했다.
- [ ] 실제 Incoming Link token refresh는 target DC에서 확인해야 한다.

### P1-2 권한 보존 evidence adapter

- [x] Jira issue/linked issue/project guard와 Confluence space search/version/selected-page re-read를 구현했다.
- [x] API call마다 active profile과 현재 user OAuth connection을 사용한다.
- [x] evidence DTO는 ID/URL/title/version/length/access/DLP status metadata로 제한한다.
- [x] Confluence raw body는 DLP/AI 직전 메모리에서만 사용하며 persistent draft/readiness에는 넣지 않는다.
- [x] Post/wiki/pgvector boundary와 user permission isolation을 tests로 확인했다.
- [ ] 실제 두 권한 사용자의 provider response 차이는 staging smoke가 필요하다.

### P1-3 hybrid DLP와 AI

- [x] secret blocker, size guard, PII/custom literal rules, output rescan을 구현했다.
- [x] synthetic key/JWT/PEM/DB URI/`.env` fixture가 AI request·DB-safe path에 닿지 않는 corpus를 통과했다.
- [x] Korean PII placeholder consistency 및 additional high-confidence categories를 테스트했다.
- [x] mock OpenAI request는 PII/secret/tools/vector indexing payload가 없고 strict structured output을 사용한다.
- [x] encrypted transient fragment 24-hour expiry/read filter/purge를 테스트했다.
- [~] custom rule admin policy/audit lifecycle과 independent cleanup scheduler/alert은 남아 있다. CLI cleanup은 실제 임시 DB에서 two-table expiry deletion을 통과했다.

### P2-1 brief draft API와 UI

- [x] citation validator, optimistic version 409, refresh, edit DLP를 구현했다.
- [x] Jira issue 선택, Jira/Confluence evidence, AI exclusion, brief edit, child-task selection UI를 제공한다.
- [x] AI generated fact-like items은 actual evidence IDs를 가진다.
- [x] UI는 409 뒤 latest draft re-review를 안내한다.
- [x] draft UI는 external write가 없는 mock publish 경계를 명시한다.
- [~] `features/auth` 디렉터리 분리는 하지 않았고 auth orchestration은 `App.tsx`에 남아 있다.

### P2-1a readiness

- [x] requirement↔selected child task↔verification evidence coverage evaluator가 있다.
- [x] createmeta required field/template comparison이 `CREATE_FIELD_MISSING`을 낸다.
- [x] 1-hop visible blocker/cross-project warning과 inaccessible dependency redaction을 구현했다.
- [x] readiness non-READY는 publish를 차단한다.
- [x] `COVERAGE_MISSING`, `CREATE_FIELD_MISSING`, access-limited no-leak fixtures를 자동 검증한다.

### P2-2 승인형 publish

- [x] mock saga의 parent/mapping/step idempotency/retry/conflict/partial-state contract를 구현했다.
- [x] no external object is created in mock mode를 persistence boundary test로 확인했다.
- [ ] real Confluence/Jira write adapter는 사용자 승인 전 intentionally absent다.

### P3-1 webhook freshness

- [x] profile route secret, CIDR boundary, shadow/manual fallback, fingerprint replay suppression, whitelist parser를 구현했다.
- [x] raw webhook title/description/comment/changelog/body는 DB/log/AI에 보내지 않는다.
- [x] relevant draft/publication만 review-required로 전환하고 own operation event를 무시한다.
- [x] ingress unverified면 parser/persistence 전 manual refresh로 fallback한다.
- [x] admin health는 mode, verified flag, CIDR count, last receive metadata, rejection metric을 반환한다.
- [~] UI는 freshness blocker와 refresh action을 제공하지만 event별 affected evidence ID를 별도 inbox row로 표시하지 않는다.
- [ ] provider signature/timestamp contract은 target DC version에서 지원이 확인될 때만 추가 검증한다.

### P3-2 운영성·테스트·파일럿

- [x] safe audit, metric, correlation ID, cleanup health, ingress health 코드가 있다.
- [x] provider-mock e2e와 FastAPI DLP corpus가 있다.
- [x] unit tests는 user isolation, OAuth expiry, DLP, conflict, partial publish, TTL, replay, readiness finding을 다룬다.
- [x] active profile deactivation은 new OAuth read/mock publish start를 차단하고 wiki RAG와 분리된다.
- [~] active profile 비활성화 rollback과 TTL 동작은 파일럿 readiness 문서에 있다. 독립적인 incident/data-deletion runbook은 아직 없다.
- [~] 자동 browser e2e suite는 아직 없다. 다만 합성 로그인 API를 사용한 실제 browser 인수에서 login 화면, 업무 브리프 화면, 빈 이슈 key validation, provider 오류 안내, accessibility tree, console warning/error 0건을 확인했다.
- [ ] actual DC staging smoke는 아직 없다.

## 10. 파일럿 순서와 Go/No-Go

- [ ] 분리된 Jira/Confluence test project/space + Keycloak test client + synthetic fixtures에서 P0–P1을 실제 확인한다.
- [ ] 권한이 다른 사용자 두 명으로 provider evidence leakage test를 실행한다.
- [ ] single active profile read-only pilot에서 draft quality/DLP false positive/readiness finding을 검토한다.
- [ ] webhook shadow mode에서 source change→review-required만 확인한다.
- [ ] 승인된 제한 사용자에게 Confluence-only write를 먼저 연다.
- [ ] remote link/comment 후 child task 순으로 real write를 연다.

다음 No-Go 항목은 모두 닫히기 전까지 external write를 열지 않는다.

- [ ] 실제 DC OAuth Incoming Link가 user permission으로 동작함
- [ ] two-user evidence isolation staging proof
- [x] synthetic secret fixture가 local AI/DB/log safe boundary를 통과하지 못함
- [ ] 유효한 OpenAI credential로 `store:false` work-brief smoke 및 approved ZDR project proof (현재 최소 인증 진단은 HTTP 401)
- [x] mock idempotency/recovery contract는 검증됨
- [~] 24-hour API read block 및 standalone cleanup의 실제 expiry deletion은 검증됐으나 independent cleanup scheduler/monitor proof 없음
- [ ] webhook route secret + allowlist/mTLS ingress proof
- [x] readiness inaccessible dependency redaction은 synthetic test로 검증됨

## 11. 배포 환경변수와 비밀값

- [x] Render YAML은 Keycloak, profile/transient encryption의 current/previous key, OAuth callback/host allowlist, AI service key 등 현재 코드가 사용하는 비밀값을 `sync:false`로 선언한다.
- [x] `OPENAI_MODEL` fallback, `WORK_COPILOT_CLEANUP_MAX_AGE_SECONDS=4200`, webhook default-off flags를 configuration에 맞췄다.
- [x] session/CSRF는 random opaque server-side state/hash를 사용하므로 계획의 legacy signing-secret 이름에 의존하지 않는다.
- [ ] 실제 secret 입력, hostname/CIDR, Keycloak/OAuth provider values, key rotation은 사용자/관리자 승인 없이 수행하지 않는다.
- [ ] independent worker/cron에는 DB connection, transient key, interval/alert configuration을 실제 배포할 때 별도로 제공해야 한다.

## 12. 명시적 제외 범위

- [-] Jira status/assignee/existing issue label 변경
- [-] Jira·Confluence 전사 원문 복제 또는 global vector search
- [-] model automatic publish/automatic child-task creation
- [-] multi-person approval 및 automatic approval invalidation workflow
- [-] OpenAI ZDR contract approval process 자체

## 로컬 최종 검증 기록

| 명령 | 결과 |
| --- | --- |
| `npm run build` | 통과 (backend + frontend production build) |
| `npm test` | 통과: 64 suites, 178 tests |
| `npm run test:cov --workspace=backend -- --runInBand` | 통과: 64 suites, 178 tests; statements 72.70%, branches 64.34%, functions 72.70%, lines 72.27% |
| `npm run test:e2e --workspace=backend -- --runInBand` | 통과: 2 suites, 2 tests (loopback bind가 필요한 sandbox 실행은 승인된 local-only 환경에서 수행) |
| `backend/ai-service/.venv/bin/python -m unittest discover -s tests -v` | 통과: 26 tests |
| `npm run lint --workspace=frontend` | 통과 |
| `backend: tsc --noEmit --incremental false -p tsconfig.build.json` | 통과 (production source typecheck) |
| 이번 변경 파일 ESLint | 통과 (crypto rotation, OAuth token rotation, transient rotation, Render config spec) |
| `docker compose config --quiet` | 통과 |
| blank PostgreSQL migration | 통과: 네 migration up → 네 migration down → `migration:show` 전부 `[ ]` |
| existing-like rollback guard | 통과: synthetic Keycloak-only user가 있으면 `WORK_COPILOT_LEGACY_PASSWORD_ROLLBACK_BLOCKED`로 destructive down 전 중단 |
| `cleanup:run:compiled` + PostgreSQL | 통과: synthetic expired `transient_evidence_fragments`/`source_change_events`를 각각 1건씩 삭제하고 count `0|0` 확인 |
| compiled API HTTP smoke | 통과: 합성 config + temporary DB에서 `/health` = `OK`, unauthenticated `/auth/me` = 401, untrusted Origin write = 403 |
| browser acceptance | 통과: 합성 login API로 업무 브리프 UI와 client validation/error, accessibility tree, console warning/error 0건 확인 |
| OpenAI API authentication diagnostic | 실패(예상 No-Go): configured credential의 `/v1/models` 최소 인증이 HTTP 401. 키/응답 본문은 노출하지 않았고 generation call은 수행하지 않음 |
| `git diff --check` | 통과 |

`SafeHttpExceptionFilter`의 synthetic 500 warning과 FastAPI/Starlette deprecation warning은 테스트 fixture/runtime dependency warning이며 test failure가 아니다. 각각 실제 production error body나 source text를 출력하지 않는다. 전체 backend ESLint는 이번 작업 이전부터 존재한 formatting/test typing 문제로 733건을 보고하므로 전체 lint 통과 증거로 사용하지 않았다. 대신 production source typecheck와 이번 변경 파일 lint를 통과시켰다.

## 이번 인수에서 수정·커밋한 결함

| 커밋 | 수정 및 검증 |
| --- | --- |
| `6ed498d` | webhook 재검토 뒤 unchanged source refresh가 draft를 영구 `REVIEW_REQUIRED`에 두던 결함을 수정하고 회귀 테스트 추가 |
| `20ebb9e` | Render frontend API URL과 OpenAI `store:false`/transient key version 선언 수정 |
| `385eb3a` | 독립 실행 가능한 expiry cleanup runner/CLI와 unit·실제 PostgreSQL deletion test 추가 |
| `9ffffb5` | Keycloak-only account가 있는 migration rollback을 destructive DDL 전에 차단하는 guard 추가 |
| `63da314` | current/previous encryption key 호환 및 profile/OAuth/transient lazy re-encryption 추가 |
| `74287f4` | key rotation 회귀 test의 타입/lint 안전성 보강 |
| `a6adbae` | OAuth 설정을 위해 읽은 legacy profile secret 전체를 CAS 조건으로 현재 키에 재암호화 |

## 실제 staging 인수에 필요한 제출물

- [ ] Keycloak realm/client/claim screenshot 또는 admin export (secret 제외)
- [ ] Jira·Confluence DC version, OAuth scope, redirect URI, user A/B permission matrix
- [ ] `createmeta` required-field result와 child template mapping
- [ ] reverse proxy/WAF CIDR 또는 mTLS verification record, webhook body exclusion setting
- [ ] OpenAI project data-control/ZDR approval evidence
- [~] blank DB migration up/down log (local temporary DB 통과; 실제 existing DB copy는 approval 필요)
- [ ] independent cleanup scheduler last-success/70-minute alert evidence
- [~] browser manual acceptance report (통과)와 automated browser e2e report, actual DC read-only/shadow-mode smoke report
- [ ] real write adapter approval, Confluence-only then Jira link/comment then child task rollout evidence
