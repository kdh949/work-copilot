# Ubuntu 24.04 단일 서버 배포

이 배포는 React 웹, NestJS API, FastAPI AI, PostgreSQL + pgvector를 한 서버의
Docker Compose로 실행한다. 공개 TLS는 Sophos WAF에서 끝나며, Ubuntu 서버에는
WAF 전용 사설 IP의 HTTP `7236`만 연결된다. Keycloak, Jira/Confluence, OpenAI는
기존 외부 서비스를 그대로 사용한다.

## 1. 서버 준비

Ubuntu 24.04에 Docker Engine과 Compose v2를 설치하고 저장소를
`/opt/work-copilot`에 배치한다. Docker daemon 접근은 운영 관리자 계정만
허용한다.

```bash
sudo install -d -m 0750 /opt/work-copilot /var/lib/work-copilot/backups
sudo chown "$USER":"$USER" /opt/work-copilot
git clone https://github.com/kdh949/work-copilot.git /opt/work-copilot
cd /opt/work-copilot
cp deploy/.env.production.example .env.production
chmod 600 .env.production
```

`.env.production`에는 실제 비밀값만 입력한다. `DB_PASSWORD`에 URL 예약 문자가
있으면 AI용 `DATABASE_URL`에는 percent-encoded 값을 사용한다. OIDC·integration·transient
암호화 키는 각각 새 base64 32-byte 키로 발급하고, `AI_SERVICE_API_KEY`는 API와 AI에
같은 값을 넣는다.

```bash
openssl rand -base64 32
```

`SERVER_BIND_ADDRESS`는 WAF가 도달할 Ubuntu의 **사설/LAN IP**다. 공개 IP나
`0.0.0.0`을 입력하지 않는다.

## 2. Compose 기동

```bash
docker compose --env-file .env.production up --build -d
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 migration api web
```

`migration`은 빈 PostgreSQL에 schema migration을 적용한 뒤 정상 종료한다. `postgres`,
`ai`, `api`, `cleanup`, `web`은 `running` 상태여야 한다. 공개 API health 경로는
`https://work-copilot.dhkim.cloud/api/health`이며 `OK`를 반환한다.

개발 환경에서는 운영 Compose를 사용하지 않는다.

```bash
docker compose -f compose.dev.yaml up -d
```

## 3. Sophos WAF와 네트워크 경계

Sophos WAF에 다음 reverse-proxy 규칙을 만든다.

- public virtual server: `work-copilot.dhkim.cloud`, HTTPS `443`, 해당 도메인 인증서
- real web server: Ubuntu의 `SERVER_BIND_ADDRESS`, HTTP `7236`
- backend로 `Host`와 `X-Forwarded-For`를 전달한다. Nginx가 API에 외부 scheme을
  HTTPS로 전달한다.
- Ubuntu의 Docker published port `7236`은 WAF 사설 IP/CIDR에서만 접근 가능하게
  한다. Sophos에서 일반 DNAT 규칙을 만들지 않고 WAF reverse-proxy 규칙만 사용한다.

Compose는 WAF와 Nginx 두 홉에 맞춰 `TRUST_PROXY_HOPS=2`를 요구한다. 이 값은
WAF를 우회해 API에 직접 도달할 수 없는 네트워크 경계에서만 사용한다. Sophos WAF는
클라이언트 IP를 `X-Forwarded-For`로 전달하고 real server에 HTTP 또는 HTTPS를
사용할 수 있다. [Sophos WAF 설정 안내](https://docs.sophos.com/nsg/sophos-firewall/21.0/Help/en-us/webhelp/onlinehelp/index.html?contextId=rules-policies-WAF-add)

Keycloak client redirect URI를 다음으로 변경한다.

```text
https://work-copilot.dhkim.cloud/api/auth/oidc/callback
```

Jira와 Confluence OAuth client redirect URI도 각각 다음을 등록한다.

```text
https://work-copilot.dhkim.cloud/api/integrations/jira/callback
https://work-copilot.dhkim.cloud/api/integrations/confluence/callback
```

`WEBHOOK_SHADOW_MODE`와 `WEBHOOK_INGRESS_VERIFIED`는 Sophos를 통과한 provider IP
allowlist와 route secret을 실제로 검증하기 전까지 `false`로 둔다.

## 4. 백업과 복구 확인

일일 local dump를 설치한다. 이 timer는 03:15 UTC 기준으로 실행 시점을 최대 15분
분산하고, 서버가 꺼져 있던 날의 실행을 다음 부팅 후 보충한다.

```bash
sudo install -m 0644 deploy/systemd/work-copilot-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/work-copilot-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now work-copilot-backup.timer
sudo systemctl start work-copilot-backup.service
sudo systemctl status work-copilot-backup.service --no-pager
sudo ls -l /var/lib/work-copilot/backups
```

dump는 PostgreSQL custom format이며 14일보다 오래된 `work-copilot-*.dump`만 자동
삭제한다. 복구는 운영 DB를 덮어쓰기 전에 별도 빈 PostgreSQL에서 `pg_restore --list`
검증을 거친 뒤에만 수행한다.

## 5. 업데이트와 전환

```bash
cd /opt/work-copilot
git pull --ff-only origin main
docker compose --env-file .env.production up --build -d
docker compose --env-file .env.production ps
```

전환 완료 후 Render의 API·AI 서비스 자동 배포를 중지하고 Vercel의 production Git
배포를 해제한다. 이 저장소에는 Render/Vercel 배포 정의를 유지하지 않는다. 전환 뒤에는
WAF 외부 `443` 접근, 동일 출처 로그인·CSRF, Keycloak callback, Jira/Confluence OAuth
callback, admin health, backup 생성 순서로 점검한다.
