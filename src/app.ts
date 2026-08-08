import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { AppConfig } from "./config.js";
import { Metrics } from "./lib/metrics.js";
import type { RateLimiter } from "./lib/rladder/types.js";
import type { Repository } from "./lib/storage/repository.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerPublicRoutes } from "./routes/public.js";

export interface AppDeps {
  config: AppConfig;
  log: Logger;
  repo: Repository;
  limiter: RateLimiter;
  metrics: Metrics;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, log, repo, limiter, metrics } = deps;

  const appServer = Fastify({
    loggerInstance: log,
    trustProxy: true,
    bodyLimit: 64 * 1024,
    requestTimeout: 10_000,
  });
  const app = appServer as unknown as FastifyInstance;

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (reply.sent) return;
    const status = err.statusCode ?? 500;
    req.log.error({ err, url: req.url }, "unhandled request error");
    reply.code(status).send({
      ok: false,
      error: status === 500 ? "internal_error" : "validation_error",
      message: status === 500 ? undefined : err.message,
    });
  });

  app.addHook("onResponse", (req, reply, done) => {
    const routeUrl = req.routeOptions.url;
    metrics.tick(
      req.method,
      typeof routeUrl === "string" ? routeUrl : req.url,
      Date.now(),
    );
    done();
  });

  registerPublicRoutes(app, {
    repo,
    limiter,
    rateLimitPerMin: config.RATE_LIMIT_PER_MIN,
  });
  registerAdminRoutes(app, {
    repo,
    limiter,
    metrics,
    adminKey: config.ADMIN_KEY,
  });
  registerMetricsRoute(app, metrics, config.ADMIN_KEY);

  registerDashboard(app);
  return app;
}

function dashboardAssetPaths(rel: string): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(process.cwd(), "web", rel),
    path.resolve(moduleDir, "..", "web", rel),
    path.resolve(moduleDir, "..", "..", "web", rel),
  ];
}

function registerDashboard(app: FastifyInstance): void {
  const cache = new Map<string, Promise<Buffer>>();

  function readAsset(rel: string): Promise<Buffer> {
    const cached = cache.get(rel);
    if (cached) return cached;
    const promise = (async () => {
      const candidates = dashboardAssetPaths(rel);
      for (const filePath of candidates) {
        try {
          return await readFile(filePath);
        } catch {
          // try next
        }
      }
      throw new Error(`dashboard asset not found: web/${rel}`);
    })();
    cache.set(rel, promise);
    return promise;
  }

  app.get("/", async (_req, reply) => {
    try {
      reply
        .type("text/html; charset=utf-8")
        .code(200)
        .send(await readAsset("dashboard.html"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "asset_missing";
      reply.code(500).send({ ok: false, error: message });
    }
  });

  app.get("/dashboard", async (_req, reply) => {
    try {
      reply
        .type("text/html; charset=utf-8")
        .code(200)
        .send(await readAsset("dashboard.html"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "asset_missing";
      reply.code(500).send({ ok: false, error: message });
    }
  });

  app.get("/dashboard.js", async (_req, reply) => {
    try {
      reply
        .type("text/javascript; charset=utf-8")
        .code(200)
        .send(await readAsset("dashboard.js"));
    } catch {
      reply.code(404).send({ ok: false, error: "not_found" });
    }
  });

  app.get("/dashboard.css", async (_req, reply) => {
    try {
      reply
        .type("text/css; charset=utf-8")
        .code(200)
        .send(await readAsset("dashboard.css"));
    } catch {
      reply.code(404).send({ ok: false, error: "not_found" });
    }
  });
}