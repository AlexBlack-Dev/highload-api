# High-Load API

A high-performance HTTP API service: Fastify + TypeScript, pluggable rate limiting (memory / Redis), SQLite or PostgreSQL storage, admin dashboard and load benchmarks. Designed to run without external infrastructure, with production backends available via env vars.

## Quick start (zero infrastructure)

```cmd
npm install
npm run dev        :: starts on http://localhost:3000 with in-memory limiter + SQLite
```

No Docker, no Postgres, no Redis required for local runs.

## API surface

### Public

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness probe (also reports store type) |
| GET | `/v1/mirror` | High-RPS echo: returns request id, timestamp, user-agent |
| POST | `/v1/echo` | Validated payload echo (schema enforced) |
| GET | `/v1/rate` | Current rate-limit status for the caller IP |

### Admin (header `X-Admin-Key`, default `dev-admin-key`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/keys` | List API keys |
| POST | `/admin/keys` | Create API key |
| DELETE | `/admin/keys/:id` | Revoke API key |
| GET | `/admin/stats` | Per-route request counters |
| GET | `/admin/quota` | Per-key rate-limit snapshot |
| GET | `/admin/dashboard` | Aggregate data for the web dashboard |

## Rate limiting

`src/lib/rladder/` — sliding window (two-bucket rolling count), pluggable store:

- **memory** (default): O(1) amortized, fine for single-node.
- **redis**: Lua-backed atomic zset operations for distributed nodes.

Every API key gets its own bucket; anonymous routes are limited per IP (120 rpm).
API keys are resolved through a TTL LRU cache (`src/lib/lru.ts`, 5 s) so the hot
path never hits the database per request.

## Storage

`src/lib/storage/` implements a small repository interface with two drivers:

- **sqlite** (default, `data/app.db`, via `better-sqlite3`)
- **postgres** (selected by setting `DATABASE_URL=postgres://...`)

## Load testing

```cmd
npm run bench          :: autocannon: 15s x 50 conn, GET /v1/mirror
npm run bench:post     :: POST /v1/echo with body
```

Measured on a dev laptop (Node 24, one process, memory limiter + SQLite):

| Scenario | Throughput | p50 latency |
|---|---|---|
| `/v1/mirror`, API key, cache warm | ~21 000 req/s | 2 ms |
| `/v1/mirror`, no cache (DB lookup) | ~11 500 req/s | 4 ms |

## Production mode

```cmd
docker compose up --build
```

or swap `RATE_STORE=redis` + `DATABASE_URL=postgres://...` without code changes
(drivers implement the same repository interface).

## Env

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `ADMIN_KEY` | `dev-admin-key` | Admin auth |
| `RATE_STORE` | `memory` | `memory` | `redis` |
| `REDIS_URL` | — | Used when `RATE_STORE=redis` |
| `DATABASE_URL` | `sqlite:./data/app.db` | `postgres://...` switches driver |
| `RATE_LIMIT_PER_MIN` | `600` | Per-key rpm |
| `LOG_LEVEL` | `info` | pino level |

## Layout

```
src/
  app.ts          Fastify bootstrap
  server.ts       entry
  config.ts       env parsing
  lib/
    rladder/      rate limiter (memory + redis + lua)
    storage/      repository interface: sqlite + postgres
    lru.ts        small TTL cache
    logging.ts    pino setup
  routes/         public.ts admin.ts health.ts metrics.ts
tests/            vitest
bench/            autocannon configs
web/              static dashboard (plain HTML/JS, served by Fastify)
```

## License

MIT