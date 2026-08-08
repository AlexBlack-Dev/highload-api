import { timingSafeEqual } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { hashApiKey, randomApiKey, randomId } from "../lib/auth.js";
import type { Metrics } from "../lib/metrics.js";
import type { RateLimiter } from "../lib/rladder/types.js";
import type { Repository } from "../lib/storage/repository.js";

export interface AdminDeps {
  repo: Repository;
  limiter: RateLimiter;
  metrics: Metrics;
  adminKey: string;
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function requireAdminKey(expected: string) {
  return async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const provided = req.headers["x-admin-key"];
    if (
      typeof provided !== "string" ||
      !safeEqual(provided, expected)
    ) {
      reply.code(401);
      reply.send({ ok: false, reason: "unauthorized" });
    }
  };
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const { repo, limiter, metrics, adminKey } = deps;
  const adminGuard = requireAdminKey(adminKey);

  app.get("/admin/keys", { preHandler: adminGuard }, async () => {
    const keys = await repo.listApiKeys();
    return { ok: true, keys: keys.map((k) => ({ id: k.id, name: k.name, revoked: k.revoked === 1, createdAt: k.createdAt })) };
  });

  app.post(
    "/admin/keys",
    {
      preHandler: adminGuard,
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 2, maxLength: 64 } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const { name } = req.body as { name: string };
      const id = randomId();
      const plain = randomApiKey();
      const createdAt = Date.now();
      await repo.createApiKey({
        id,
        name,
        hash: hashApiKey(plain),
        createdAt,
        revoked: 0,
      });
      return { ok: true, id, name, key: plain, createdAt };
    },
  );

  app.delete("/admin/keys/:id", { preHandler: adminGuard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const revoked = await repo.revokeApiKey(id);
    if (!revoked) {
      reply.code(404);
      return { ok: false, reason: "not_found" };
    }
    return { ok: true, revoked: true };
  });

  app.get("/admin/stats", { preHandler: adminGuard }, async () => ({
    ok: true,
    totalHits: metrics.totalHits,
    rps: metrics.ratePerSecond(),
    uptimeMs: metrics.uptimeMs,
    routes: metrics.getRoutes(),
  }));

  app.get("/admin/quota", { preHandler: adminGuard }, async () => {
    const keys = await repo.listApiKeys();
    const quotas = [];
    for (const key of keys) {
      const status = limiter.peek
        ? await limiter.peek(`key:${key.id}`, 600, 60_000)
        : { allowed: true, remaining: 600, retryAfterMs: 0 };
      quotas.push({ id: key.id, name: key.name, revoked: key.revoked === 1, ...status });
    }
    return { ok: true, quotas };
  });

  app.get("/admin/dashboard", { preHandler: adminGuard }, async () => ({
    ok: true,
    service: {
      store: process.env.RATE_STORE ?? "memory",
      db: process.env.DATABASE_URL?.startsWith("postgres") ? "postgres" : "sqlite",
      limitPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 600),
    },
    stats: {
      totalHits: metrics.totalHits,
      rps: metrics.ratePerSecond(),
      uptimeMs: metrics.uptimeMs,
    },
    routes: metrics.getRoutes(),
  }));
}