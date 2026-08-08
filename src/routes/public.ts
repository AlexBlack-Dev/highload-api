import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { hashApiKey } from "../lib/auth.js";
import { TtlLru } from "../lib/lru.js";
import type { RateLimiter } from "../lib/rladder/types.js";
import type { ApiKeyRecord, Repository } from "../lib/storage/repository.js";

export interface PublicDeps {
  repo: Repository;
  limiter: RateLimiter;
  rateLimitPerMin: number;
}

const WINDOW_MS = 60_000;
const ANON_LIMIT_PER_MIN = 120;

interface KeyCache {
  get(hash: string): Promise<ApiKeyRecord | null>;
  invalidate(hash: string): void;
}

export function createApiKeyCache(fetch: (hash: string) => Promise<ApiKeyRecord | null>): KeyCache {
  const cache = new TtlLru<string, ApiKeyRecord>(10_000, 5_000);
  const inflight = new Map<string, Promise<ApiKeyRecord | null>>();
  return {
    get(hash) {
      const cached = cache.get(hash);
      if (cached) return Promise.resolve(cached);
      const pending = inflight.get(hash);
      if (pending) return pending;
      const promise = fetch(hash).then((record) => {
        if (record) cache.set(hash, record);
        return record;
      }).finally(() => {
        inflight.delete(hash);
      });
      inflight.set(hash, promise);
      return promise;
    },
    invalidate(hash: string) {
      cache.delete(hash);
    },
  };
}

function extractApiKey(req: FastifyRequest): string | undefined {
  const raw = req.headers["x-api-key"];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

type GuardOutcome =
  | { ok: true; limit: number; remaining: number }
  | { ok: false; status: 401 | 429; limit: number; remaining: number; retryAfterSec: number };

async function guardRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: PublicDeps,
  keyCache: KeyCache,
): Promise<GuardOutcome> {
  const { repo, limiter, rateLimitPerMin } = deps;
  const apiKey = extractApiKey(req);

  let bucketKey: string;
  let limit: number;
  if (apiKey) {
    const record = await keyCache.get(hashApiKey(apiKey));
    if (!record || record.revoked === 1) {
      reply.code(401);
      return { ok: false, status: 401, limit: 0, remaining: 0, retryAfterSec: 0 };
    }
    bucketKey = `key:${record.id}`;
    limit = rateLimitPerMin;
  } else {
    bucketKey = "ip:" + req.ip;
    limit = ANON_LIMIT_PER_MIN;
  }

  const decision = await limiter.consume(bucketKey, limit, WINDOW_MS);
  if (!decision.allowed) {
    reply.header("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
    reply.code(429);
    return {
      ok: false,
      status: 429,
      limit,
      remaining: 0,
      retryAfterSec: Math.ceil(decision.retryAfterMs / 1000),
    };
  }
  reply.header("X-RateLimit-Remaining", String(decision.remaining));
  return { ok: true, limit, remaining: decision.remaining };
}

export function registerPublicRoutes(app: FastifyInstance, deps: PublicDeps): void {
  const { repo, limiter, rateLimitPerMin } = deps;
  const keyCache = createApiKeyCache((hash) => repo.getApiKeyByHash(hash));

  app.get("/health", async () => ({
    status: "ok",
    ts: Date.now(),
    uptimeSec: Math.floor(process.uptime()),
  }));

  app.get("/v1/mirror", async (req, reply) => {
    const guard = await guardRateLimit(req, reply, deps, keyCache);
    if (!guard.ok) {
      return { ok: false, reason: guard.status === 401 ? "invalid_api_key" : "rate_limited" };
    }
    return {
      ok: true,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      ua: req.headers["user-agent"] ?? null,
      via: "highload-api",
    };
  });

  app.post(
    "/v1/echo",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: { text: { type: "string", minLength: 1, maxLength: 1024 } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const guard = await guardRateLimit(req, reply, deps, keyCache);
      if (!guard.ok) {
        return { ok: false, reason: guard.status === 401 ? "invalid_api_key" : "rate_limited" };
      }
      const body = req.body as { text: string };
      return {
        ok: true,
        echo: body.text,
        len: body.text.length,
        remaining: guard.remaining,
        ts: new Date().toISOString(),
      };
    },
  );

  app.get("/v1/rate", async (req) => {
    const apiKey = extractApiKey(req);
    const limit = apiKey ? rateLimitPerMin : ANON_LIMIT_PER_MIN;
    const bucketKey = apiKey
      ? `key:${(await repo.getApiKeyByHash(hashApiKey(apiKey)))?.id ?? "unknown"}`
      : "ip:" + req.ip;
    const decision = limiter.peek
      ? await limiter.peek(bucketKey, limit, WINDOW_MS)
      : { allowed: true, remaining: limit, retryAfterMs: 0 };
    return { windowMs: WINDOW_MS, limit, ...decision };
  });
}