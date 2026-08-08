import type { FastifyInstance } from "fastify";
import type { Metrics } from "../lib/metrics.js";
import { requireAdminKey } from "./admin.js";

export function registerMetricsRoute(
  app: FastifyInstance,
  metrics: Metrics,
  adminKey: string,
): void {
  app.get(
    "/metrics",
    { preHandler: requireAdminKey(adminKey) },
    async () => {
      const lines: string[] = [
        '# HELP hl_requests_total Total requests served',
        '# TYPE hl_requests_total counter',
      ];
      for (const route of metrics.getRoutes()) {
        lines.push(`hl_requests_total{route="${route.route}"} ${route.hits}`);
      }
      lines.push("# TYPE hl_rps gauge");
      lines.push(`hl_rps ${metrics.ratePerSecond()}`);
      lines.push("# TYPE hl_uptime_seconds gauge");
      lines.push(`hl_uptime_seconds ${Math.floor(metrics.uptimeMs / 1000)}`);
      return lines.join("\n") + "\n";
    },
  );
}