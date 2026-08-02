# Work Copilot 파일럿 준비 상태

기준일: 2026-08-02

현재 판정: **No-Go**. 로컬 코드·mock 검증은 통과했지만 실제 OAuth/ingress 관리자 확인, 독립 cleanup scheduler/alert, automated browser e2e, DC staging smoke, ZDR project 증명이 남아 있다. configured OpenAI credential의 최소 인증 진단도 HTTP 401로 실패했다. 상세 대조표는 `jira-confluence-work-copilot-final-acceptance-checklist.md`를 따른다.

## 기본 안전 동작

- Jira·Confluence webhook은 `POST /webhooks/:profileId/:provider`로만 들어오며, source ID·version·수신 시각·fingerprint·고정 ingress 결과만 보관한다. title, description, comment, changelog, 원문 payload와 오류 본문은 저장하거나 로그·AI 요청에 넣지 않는다.
- 기본값은 `manual_refresh`다. `WEBHOOK_SHADOW_MODE=true`, `WEBHOOK_INGRESS_VERIFIED=true`, 유효한 `WEBHOOK_INGRESS_ALLOWED_CIDRS`, 활성 프로필의 암호화된 route secret이 모두 있을 때만 `shadow` intake가 된다.
- shadow intake는 관련 draft와 기존 publication을 재검토 상태로만 표시한다. Jira·Confluence 외부 write는 호출하지 않는다.
- 같은 profile/source ID/version의 재전송은 24시간 안전 metadata fingerprint로 억제한다. 자체 Confluence operation ID가 붙은 이벤트는 freshness 전이 전에 무시한다.
- 암호화된 evidence 발췌와 source-change metadata는 최대 24시간 TTL이며, API read는 만료 행을 즉시 제외한다. web process timer와 독립 실행 명령 `npm run cleanup:run:compiled --workspace=backend`가 있으며, synthetic expired row 두 종류를 실제 temporary PostgreSQL에서 삭제하는 것을 확인했다. 운영 Go 전에는 scheduler와 70분 경보를 증명해야 한다.
- encryption key rotation은 current/previous key를 함께 제공하는 동안 profile secret·OAuth token·active transient fragment를 읽을 때 current key로 다시 암호화한다. 실제 Render secret cutover는 관리자 승인 후에만 수행한다.
- 관리자가 활성 프로필을 비활성화하면 새 OAuth 기반 읽기와 mock publish 시작은 차단되고, 기존 wiki 기능은 영향을 받지 않는다.

## 자동 검증 매트릭스

| 경계 | 자동 검증 |
| --- | --- |
| 사용자별 권한 격리 | Jira/Confluence work-item 및 readiness 테스트가 다른 사용자 OAuth 연결·권한 없는 linked issue metadata를 노출하지 않는지 확인 |
| DLP·비밀값 | `work-brief-content-guard` 및 webhook ingest 테스트가 API key, JWT, PEM, DB URI, `.env` fixture와 한국어 PII가 AI 요청·안전 metadata·감사 이벤트에 남지 않음을 확인 |
| OAuth 만료 | `integrations-oauth.service.spec.ts`가 refresh/재승인 필요 상태를 확인 |
| optimistic conflict | `work-briefs.service.spec.ts`와 UI 409 흐름이 최신 초안 재검토를 강제 |
| partial publish | `publication.service.spec.ts`가 Confluence conflict와 단계별 부분 성공의 복구·idempotency를 확인 |
| webhook replay | `webhook-ingest.service.spec.ts`가 unique fingerprint 재전송을 freshness 전이 없이 무시하는지 확인 |
| TTL·cleanup health | transient evidence와 source-change event의 만료 삭제 및 health 상태를 확인 |
| cleanup CLI integration | temporary PostgreSQL에서 만료 fragment/event를 각각 1건씩 삭제하고 count `0|0` 확인 |
| provider mock/e2e | mock publication gateway와 `work-copilot-webhooks.e2e-spec.ts`가 외부 provider 연결 없이 HTTP 경계를 검증 |
| browser acceptance | 합성 login API를 사용해 login/work-brief 화면·validation/error·accessibility tree·console warning/error 0건 확인. automated suite는 아직 없음 |

## Go / No-Go

| 항목 | 코드 상태 | 외부 관리자 확인 |
| --- | --- | --- |
| 사용자별 OAuth와 최소 scope | 준비됨 | 실제 Jira·Confluence OAuth 앱의 redirect URI·scope·만료 동작을 사용자 계정별로 확인 |
| route secret 회전 | 준비됨 | 관리자 API로 profile별 secret을 입력·회전하고 값이 응답·로그에 없는지 확인 |
| webhook ingress | 기본 차단 | reverse proxy/WAF의 provider IP 또는 mTLS 경계와 앱 CIDR을 함께 검증한 뒤에만 `WEBHOOK_INGRESS_VERIFIED=true` 설정 |
| shadow freshness | 준비됨 | synthetic 변경 이벤트가 관련 draft만 `review_required`로 만드는지 staging에서 확인 |
| 외부 write | mock 전용 | 파일럿 동안 real write adapter는 승인 전까지 추가·활성화하지 않음 |
| TTL 정리 | API read filter·process purge·standalone CLI 준비됨 | scheduler의 두 cleanup job과 70분 alert를 운영에서 확인 |
| 로그·감사 | 준비됨 | 로그 수집/오류 추적 샘플에서 title·본문·payload·token·route secret이 없는지 확인 |

다음 중 하나라도 미충족이면 **No-Go**다: ingress 검증 플래그가 없는 상태에서 shadow를 강제하려는 경우, 사용자가 아닌 공유 OAuth를 쓰는 경우, DLP/TTL/권한 격리 테스트 실패, cleanup health가 degraded인 경우, 또는 real external write가 mock 경계를 우회하는 경우.

## 승인 후 staging smoke 순서

1. 새 staging 배포에서 `GET /health`와 관리자 `GET /admin/work-copilot/health`를 확인한다. 처음에는 `manual_refresh`와 pending cleanup이 정상이다.
2. 실제 OAuth 등록과 provider webhook 등록은 별도 사용자 승인 후에만 수행한다. 등록 전에는 provider mock과 로컬 e2e만 사용한다.
3. 관리자가 profile별 route secret을 회전하고, reverse proxy/WAF ingress 경계를 검증한다. 검증 기록이 있을 때만 CIDR·shadow 관련 환경값을 설정한다.
4. synthetic Jira/Confluence 변경 하나를 보내고, 원문 없이 마지막 수신 시각만 갱신되며 영향 받은 draft/publication만 재검토 상태가 되는지 확인한다.
5. duplicate event, 잘못된 route secret, 허용되지 않은 IP를 재현한다. 각각 외부 write 없이 replay 억제·안전 거절·수동 새로 고침 상태여야 한다.
6. 24시간 TTL을 짧은 staging 설정으로 검증한 뒤, 두 cleanup job의 성공 시각·삭제 수가 운영 화면에 나타나는지 확인한다.
7. 이상 징후가 있으면 활성 profile을 비활성화한다. 이는 새로운 외부 읽기와 publish 시작을 멈추며 wiki RAG에는 영향을 주지 않는다.

이 문서는 실제 OAuth 등록, 외부 Jira/Confluence write, 배포, 비밀값 입력을 수행하지 않는다.

## 검증 기록

- `npm run build`는 backend와 frontend production build를 통과했다.
- `npm test`는 64 suite/178 test를 통과했다. Jest config에서 Watchman을 꺼 sandbox 환경에서도 동일 명령을 사용한다.
- provider-mock e2e는 2 suite/2 test를 통과했다. loopback bind가 필요한 실행은 외부 provider 호출 없이 local-only 실행 환경에서 검증했다.
- FastAPI 전체 test corpus는 26 test를 통과했다.
- frontend 전체 lint와 production build는 모두 통과했다.
- temporary PostgreSQL blank migration up/down, actual cleanup deletion, compiled API `/health`/401/403 HTTP smoke를 통과했다.
- OpenAI credential 최소 인증은 HTTP 401로 실패했다. 키/response body는 출력하지 않았고 generation request는 수행하지 않았다.
