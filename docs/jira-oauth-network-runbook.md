# Jira OAuth 네트워크 경계 운영 절차

## 적용 대상

- Render 서비스: `work-copilot-api` (`srv-d9npfkm1egvs738ih020`)
- Render region: Oregon
- Outbound CIDR 확인일: 2026-08-04 (Render Dashboard)
- Outbound CIDR: `74.220.48.0/24`, `74.220.56.0/24`
- Jira host: `jira.dhkim.cloud`
- OAuth token path: `POST /rest/oauth2/latest/token`
- 읽기 path: `GET /rest/api/2/project/*`, `GET /rest/api/2/issue/*`

브라우저에서 호출하는 OAuth authorize·consent path는 이 예외에 포함하지 않는다.

## Sophos WAF 변경

1. Render Dashboard의 서비스 상세 화면에서 **Connect → Outbound**를 열어
   표시되는 모든 CIDR을 복사한다. 과거 기록이나 인터넷 검색 결과를 대신
   사용하지 않는다.
2. CIDR 목록, 확인 시각, Render 서비스 ID를 변경 기록에 남기고
   `render-oregon-work-copilot-egress` 네트워크 그룹을 동일한 값으로 갱신한다.
3. 위 source 그룹과 적용 대상 method·path가 모두 일치할 때만 OAuth·REST
   요청을 허용한다. 오탐을 발생시킨 source reputation 또는 signature 검사만
   예외 처리하고 TLS, rate limit과 나머지 WAF 검사는 유지한다.
4. Jira 전체 host, `/rest/*` 전체 또는 Render CIDR의 모든 요청을 허용하는
   규칙은 만들지 않는다.

## 변경 전후 확인

1. 관리자 연동 프로필의 **연결 확인**을 실행한다.
2. 변경 전 `Jira token endpoint: 네트워크 경계 차단` 결과와 같은 시각의
   Sophos deny 로그가 일치하는지 확인한다.
3. WAF 변경 후 같은 점검이 `확인됨`으로 바뀌는지 확인한다. 진단 요청은
   공개 dummy credential만 사용하며 Jira가 반환하는 JSON 4xx는 endpoint
   도달 성공을 뜻한다.
4. 새 OAuth 연결을 시작해 사용자 동의, callback, `connected` 상태와 허용된
   프로젝트의 issue READ 조회를 확인한다.
5. 허용되지 않은 프로젝트가 애플리케이션 allowlist에서 계속 거부되고,
   Render 이외 source에는 기존 WAF 정책이 적용되는지 확인한다.
6. Render 로그에서 `PROVIDER_NETWORK_REJECTED`가 재발하지 않고 `/health`가
   200인지 확인한다.

Sophos에 해당 deny 기록이 없다면 같은 시각의 다음 reverse proxy access·security
로그를 확인해 최초 403 계층에서 동일하게 제한된 예외를 적용한다.

## 정기 점검

- 분기마다, 그리고 OAuth 네트워크 차단이 재발할 때마다 Render Dashboard의
  현재 CIDR과 Sophos 네트워크 그룹을 비교한다.
- CIDR 변경은 새 범위를 먼저 추가하고 연결 검증을 완료한 뒤 제거된 범위를
  삭제한다.
- 공유 CIDR은 다른 Render 사용자가 함께 사용하므로 method·path 범위를 넓히지
  않는다. 전용 outbound IP가 필요하면 별도 비용과 workspace plan 변경을 먼저
  승인받는다.

참고: [Render outbound IP addresses](https://render.com/docs/outbound-ip-addresses)
