# GGEE Lightweight Backend

`GGEE-Backend`(Spring Boot 4 WebFlux)를 **NestJS + TypeScript**로 이식한 경량 백엔드.
설계 근거와 이식 규칙은 [`DESIGN.md`](./DESIGN.md) 참고.

## 스택

- **NestJS 11** (Express 플랫폼) / TypeScript (strict)
- **TypeORM** + PostgreSQL 17
- **Redis** (크롤러 댓글 dedup — Kafka Streams 대체)
- JWT(HS256, jsonwebtoken), BCrypt, Snowflake ID(자체 구현)
- 외부 AI 4종은 HTTP/SSE로 직접 호출 (Kafka 제거)

## 원본 대비 변경점

| 원본 | 이식 |
|---|---|
| WebFlux(리액티브) | NestJS async/await |
| R2DBC | TypeORM |
| Kafka `crawl.request` 발행 | 크롤러로 **동기 HTTP POST** |
| Kafka Streams 댓글 dedup | **Redis SETEX**(sliding TTL) |
| Kafka 완료 이벤트 → indexing 대기 | **DB 폴링 SSE**(2s poll, 30s heartbeat, 10m ceiling) |
| Kafka 완료 콜백 | 크롤러 → `POST /internal/crawl/result` |

## 엔드포인트

인증 필요(Bearer JWT) — 단, `/auth/register|login|refresh`, `/actuator/health|info`, `/internal/*`은 공개.

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/auth/register` | 가입(+protect 색인 트리거) → 201 |
| POST | `/auth/login` | 로그인(세션 회전) → 201 |
| POST | `/auth/refresh` | 토큰 재발급(CAS) → 200 |
| POST | `/auth/logout` | 로그아웃 → 204 |
| POST | `/audit` | 입장문 검수(AI) |
| GET | `/issues` | 이슈 계통도(AI) |
| GET | `/news/:node_id` | 노드 뉴스(AI) |
| GET | `/indexing/jobs/:job_id` | 색인 완료 대기(SSE) |
| POST | `/strategy/rooms` | 방 생성 + 첫 응답 스트리밍(SSE) |
| GET | `/strategy/rooms` | 방 목록 |
| GET | `/strategy/rooms/:room_id/messages` | 메시지 목록 |
| POST | `/strategy/rooms/:room_id/messages/stream` | 이어서 채팅(SSE) |
| POST | `/internal/crawl/result` | 크롤 결과 수신(dedup + 완료 마킹) |

## 실행

```bash
cp .env.example .env      # 값 채우기 (특히 JWT_SECRET_KEY = base64)
docker compose up -d      # postgres + redis
npm install
npm run migration:run     # 스키마 생성
npm run start:dev
```

`JWT_SECRET_KEY`는 Base64 인코딩된 HMAC 키:
```bash
openssl rand -base64 48
```

## 스크립트

- `npm run start:dev` — 워치 모드
- `npm run build` / `npm run start:prod`
- `npm run typecheck` — `tsc --noEmit`
- `npm run migration:generate` / `migration:run` / `migration:revert`

## 구조

```
src/
├── config/        환경설정(타입드)
├── common/        error(ErrorCode/필터), snowflake, entity(BaseEntity), http(AI 클라이언트)
├── security/      JwtAuthGuard, @CurrentUser, Role, @Public
├── redis/         ioredis 클라이언트
├── database/      data-source + migrations
└── modules/
    ├── member/    auth(register/login/refresh/logout), JWT, 세션
    ├── protect/   protect 색인 + outbox
    ├── crawler/   크롤 결과 수신 + Redis dedup
    ├── audit/     POST /audit
    ├── issue/     GET /issues
    ├── reaction/  GET /news, GET /indexing/jobs (SSE)
    └── strategy/  SSE 채팅
```
