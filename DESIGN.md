# GGEE Lightweight Backend — 설계 문서

Spring Boot 4 WebFlux(리액티브, 헥사고날) 백엔드를 **NestJS + TypeScript**로 마이그레이션한다.
원본: `../GGEE-Backend` (Java 21, R2DBC PostgreSQL, Kafka + Kafka Streams, JWT, Snowflake).

## 1. 마이그레이션 결정 (딥인터뷰 결과)

| 항목 | 원본 | 이식 |
|---|---|---|
| 프레임워크 | Spring WebFlux (Reactive) | **NestJS + TypeScript** (async/await) |
| DB 접근 | R2DBC + R2dbcEntityTemplate | **TypeORM** (DataSource, Repository) |
| 스키마 | 기존 PostgreSQL 스키마 | **새 스키마로 재설계** (엔티티 = 스키마, 마이그레이션 생성) |
| 메시징 | Kafka + Kafka Streams | **제거 → 동기 HTTP 호출**로 단순화 |
| 크롤러 dedup | Kafka Streams 상태저장소 + TTL | **Redis SETEX(sliding TTL)** 재구현 |
| 외부 AI 4종 | WebClient (audit/issue/reaction/strategy) | 기존 **계약 그대로 HTTP 호출** (SSE 포함) |
| ID | Snowflake `long` | **Snowflake → string**(BigInt 계산, JSON은 문자열) |
| 인증 | jjwt HS256 | **jsonwebtoken** HS256 |

## 2. 핵심 이식 규칙 (byte-parity 지점)

1. **snake_case 와이어 포맷**: 모든 HTTP 요청/응답 바디는 snake_case. DTO 프로퍼티를 snake_case로 **직접** 선언(전역 변환기 미사용 → SSE 수제 JSON의 예외 케이스 보존).
2. **Snowflake ID는 문자열**: `107519243230003200` 같은 값이 `Number.MAX_SAFE_INTEGER`를 초과 → 엔티티 PK는 `bigint` 컬럼(드라이버가 string 반환), 도메인/JSON에서 string.
   - 비트 레이아웃: `((now - EPOCH) << 17) | (workerId << 12) | seq`, `EPOCH=1767225600000`(2026-01-01 UTC), worker 5bit(0–31), seq 12bit. 시계 역행 시 예외, seq overflow 시 busy-wait. 단일 프로세스 mutex.
3. **에러 모델**:
   - 비즈니스 예외(`BusinessException(ErrorCode)`) → 전역 필터가 **`text/plain` 바디 = ErrorCode 한글 메시지** + 매핑 상태코드.
   - 인증 가드 거부 → **빈 바디** + 상태코드(원본 AuthFilter 동작).
   - 검증 실패(class-validator) → 400 + 첫 위반 메시지(한글) plain-text.
4. **Soft delete**: 모든 테이블 `deleted`(boolean) + `deleted_at`. 모든 read는 `deleted=false` 필터. `createdAt` 컬럼은 **따옴표 camelCase** 이름 유지(`@CreateDateColumn({name:'createdAt'})`). `updatedAt` 없음.
5. **응답 상태코드**: register **201**, login **201**, refresh **200**, logout **204**.
6. **reviews_json**: audit 리뷰는 **camelCase JSON 문자열**로 TEXT 컬럼에 저장(HTTP 표면의 snake_case와 다름). write-only.

## 3. 모듈 맵

```
src/
├── main.ts, app.module.ts
├── config/                 # env 로드/검증, 타입드 config (db, jwt, cors, ai, crawler, redis, snowflake)
├── common/
│   ├── error/              # ErrorCode enum, BusinessException, GlobalExceptionFilter, ErrorCodeHttpStatus
│   ├── snowflake/          # SnowflakeService (IdGenerator)
│   ├── entity/             # BaseEntity (id bigint, createdAt, deleted, deletedAt)
│   └── http/               # AI HTTP 클라이언트 공통(undici/axios), SSE 파서
├── security/               # JwtAuthGuard, @CurrentUser, CORS, public-paths
├── database/               # data-source.ts, migrations/
└── modules/
    ├── member/             # auth: register/login/refresh/logout, JWT, 세션(CAS)
    ├── protect/            # protect 등록/조회, indexing job(완료추적), 크롤러 동기 HTTP, 30분 리프레시
    ├── crawler/            # 크롤 결과 수신 HTTP, Redis dedup, 다운스트림 포워딩
    ├── audit/              # POST /audit
    ├── issue/              # GET /issues
    ├── reaction/           # GET /news/:node_id, GET /indexing/jobs/:job_id (SSE 완료대기)
    └── strategy/           # SSE 채팅(create+stream, continue, 방/메시지 조회)
```

각 모듈은 헥사고날 3계층을 NestJS 관용구로 축약: `*.controller.ts`(api) / `*.service.ts`(usecase) / `*.entity.ts`+`*.repository`(infra) / `dto/`(req·res) / `*-ai.client.ts`(외부).

## 4. Kafka 제거 → 동기 HTTP 매핑

### 4.1 protect 색인 파이프라인
- **원본**: register → outbox(PENDING) → 스케줄러 claim → Kafka `crawl.request` 발행 → 크롤러 → `crawl.community.result(status=all_done)` → outbox COMPLETED.
- **이식**: register 트랜잭션(user+protect+indexing job+session) 커밋 후 → 크롤러로 **동기 HTTP POST** `${CRAWLER_BASE_URL}/crawl/request` `{ job_id, keyword, protect_target_info }`. 스케줄러/폴링 디스패치 제거.
- **outbox 아님**: 디스패처가 사라진 이상 outbox 패턴(claim + 재시도)의 이점은 없다. 남은 것은 `indexing_jobs` 잡 테이블뿐이며 상태는 `PENDING | COMPLETED | FAILED` 3개다. `claimed_at`/`published_at`/`IN_PROGRESS`/`PUBLISHED`와 디스패처용 `(status, createdAt)` 인덱스는 제거됨.
- **디스패치 실패**: register는 이미 커밋됐으므로 예외를 호출자에게 던질 수 없다. 대신 잡을 `FAILED`로 기록해 4.3의 대기자가 10분 침묵 대신 즉시 실패를 통보하게 한다. 재시도는 없다(사용자 재시도).
- **완료 콜백**: 크롤러가 `POST /internal/crawl/result`(아래 4.2)로 결과 전송, `status=="all_done"`이면 `job_id`로 COMPLETED 마킹.
- **상태 전이 우선순위**: `FAILED`는 `PENDING`에서만, `COMPLETED`는 `PENDING`과 `FAILED`에서 전이된다. 우리 쪽 10초 HTTP 타임아웃은 "요청이 도달했는가"에 대한 추측일 뿐이고 크롤러의 `all_done`은 "크롤이 끝났는가"에 대한 사실이므로, 추측이 사실을 덮지 못하게 한다. 이미 `failed`를 받고 끊긴 대기자는 재조회하면 `completed`를 본다.
- **30분 리프레시**: `@Interval(30min)` — `SELECT DISTINCT target,info WHERE deleted=false` → 각 건 새 잡(PENDING) 생성 + 크롤러 재요청(best-effort). 단일 레플리카 가정. 새 `job_id`를 발급하므로 기존 대기자를 구제하지는 않는다.

### 4.2 크롤러 dedup (Kafka Streams → Redis)
- **수신**: `POST /internal/crawl/result` — 원본 `crawl.community.result` 토픽 대체. `status=="completed"`인 경우만 dedup 처리(+ `all_done`은 잡 완료 마킹).
- **dedup 키**: `dedup:{commentId}|{postUrl}`. sliding TTL = `GGEE_CRAWLER_DEDUP_TTL`(초).
  - `existed = redis.exists(key)`; `redis.set(key, eventTs, 'EX', ttl)`(항상 갱신); 코멘트는 `!existed`일 때 NEW.
  - Redis 네이티브 만료가 원본의 `< cutoff` 판정 + purge 펑추에이터를 대체.
- **포워딩**: 새 코멘트가 1건 이상인 post마다 snowflake `post_id` 생성 → `POST ${CRAWLER_DEDUP_FORWARD_URL}/post.deduped` 1건 + `/comment.deduped` N건(미설정 시 로그). 스키마 레지스트리 제거.

### 4.3 indexing 완료 대기 (reaction)
- `GET /indexing/jobs/:job_id` (SSE 유지) — Kafka 인메모리 푸시 제거, **순수 DB 폴링**.
- heartbeat(`event:heartbeat data:ping`) 30s 간격 + 2s 마다 `indexing_jobs WHERE id=? AND deleted=false`의 상태 확인 → `COMPLETED`면 `event:completed data:done`, `FAILED`면 `event:failed data:dispatch_failed` 후 종료. 10분 상한(상한 도달 시 종료 프레임 없이 close).
- `PENDING`과 미존재 id는 계속 대기한다. register 응답이 dispatch보다 먼저 도착할 수 있어, 미존재를 즉시 실패로 단정하면 안 된다.

## 5. 인증/세션 상세

- **JWT**: HS256. secret은 **Base64 디코드** 후 HMAC 키. 헤더 type 리터럴 `"jwt"`. 클레임: `sub=userId`, `role`, `tokenType`(ACCESS_TOKEN|REFRESH_TOKEN), `sessionId`. 만료는 ms.
- **AuthGuard**: `Authorization: Bearer <jwt>` 파싱 → 검증 → `tokenType==ACCESS_TOKEN` 확인 → 세션 유효성(`findBySessionId` + `expiresAt>now`) **매 요청 확인** → `req.user = {userId, role, sessionId}`. 실패 시 빈 바디 상태코드.
- **세션**: `user_sessions`, 부분 유니크 `(user_id) WHERE deleted=false` → 사용자당 1 활성 세션.
  - login: `invalidateByUserId` → `save(newSession)` (한 트랜잭션, 세션 회전).
  - refresh: refresh 토큰 검증 → `updateRefreshTokenHash(sessionId, oldHash, newHash, newExpiresAt)` **CAS**(`WHERE refresh_token_hash=oldHash`); affected=0 → INVALID_SESSION(재사용/레이스 방어).
  - logout: `invalidateByUserId`.
- **비밀번호**: BCrypt(rounds=10). **refresh 토큰 해시**: unsalted SHA-256 hex(64자).

## 6. 외부 AI 계약 (그대로 유지)

| AI | 호출 | 요청 | 응답 |
|---|---|---|---|
| audit | `POST {base}/audit` | `{entity_name, entity_info, text}` | `{reviews:[{sentence:{sentence_text,start_offset,end_offset}, perspective_ids[], perspective_labels[], suggestions:[{start_index,end_index,before,after,reason}]}]}` |
| issue | `GET {base}/issues?entity_name=&entity_info=`(info는 non-blank시) | — | `{entity_name, issues:[{id,title,summary,date,criticism,support,interest}], connections:[{source_id,target_id,similarity}]}` |
| reaction | `GET {base}/news/{node_id}` | — | `{node_id,count,news:[{title,summary,link}]}` |
| strategy | `POST {base}/strategy/stream` (SSE) | `{message, entity_name, entity_info}` | SSE: `intent_classified{intent,refined_query}`, `content_chunk{delta}`, `meta{...}`, `done{message_id}` |

- null 병합 규칙 유지: null 숫자→0/0.0, null 리스트→[], issue `entity_name` null→요청 target.
- 타임아웃/WebClient 오류 → 각 도메인 503(`*_SERVICE_UNAVAILABLE`). 스트리밍 클라이언트는 소켓 read 타임아웃 없이 idle/total 타임아웃만.

## 7. 데이터 모델 (TypeORM 엔티티)

`users`, `user_sessions`, `protects`, `indexing_jobs`, `audits`, `strategy_chat_rooms`, `strategy_chat_messages`.
스키마는 원본 `schema.sql`과 동등하게 재정의(부분 유니크 인덱스 포함). PK는 `bigint`(string), `createdAt` 따옴표 컬럼, soft-delete 컬럼.

## 8. 설정(env)

DB(`DATABASE_URL` 또는 host/port/user/pw/db), `SERVER_PORT`, CORS 6종, JWT 5종, `SNOWFLAKE_WORKER_ID`, AI 4종 base-url/timeout, `REDIS_URL`, `GGEE_CRAWLER_DEDUP_TTL`, `CRAWLER_BASE_URL`, `CRAWLER_DEDUP_FORWARD_URL`, `NEWS_CRAWLER_BASE_URL`/`NEWS_CRAWLER_TIMEOUT`(GGEE-NEWS-CRAWLER `/search` 프록시).
제거: 모든 `KAFKA_*`, `SCHEMA_REGISTRY_URL`, dedup store/cleanup-interval, dead 변수들.

## 9. 상태코드/에러코드 매핑

401: EXPIRED_TOKEN, INVALID_TOKEN, INVALID_TOKEN_TYPE, EXPIRED_REFRESH_TOKEN, INVALID_EMAIL_OR_PASSWORD, SESSION_EXPIRED, INVALID_SESSION ·
400: INVALID_EMAIL_FORMAT ·
409: EMAIL_ALREADY_EXISTS ·
404: USER_NOT_FOUND, PROTECT_NOT_FOUND, STRATEGY_ROOM_NOT_FOUND ·
503: ISSUE_GRAPH_SERVICE_UNAVAILABLE, AUDIT_SERVICE_UNAVAILABLE, STRATEGY_AI_SERVICE_UNAVAILABLE, NEWS_SERVICE_UNAVAILABLE ·
405: METHOD_NOT_ALLOWED · 500: INTERNAL_SERVER_ERROR, CLOCK_MOVED_BACKWARDS, INVALID_WORKER_ID.
