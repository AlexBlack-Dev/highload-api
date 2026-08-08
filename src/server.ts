import { loadConfig } from "./config.js";
import { createLogger } from "./lib/logging.js";
import { Metrics } from "./lib/metrics.js";
import { createRateLimiter } from "./lib/rladder/index.js";
import { createRepository } from "./lib/storage/index.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);

  const repo = await createRepository(config, log);
  const rateHandle = await createRateLimiter(config, log);
  const metrics = new Metrics();

  const app = await buildApp({ config, log, repo, limiter: rateHandle.limiter, metrics });

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    await app.close();
    await repo.close();
    await rateHandle.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    log.info({ port: config.PORT }, "highload-api listening");
  } catch (err) {
    log.error({ err }, "failed to start");
    await repo.close();
    await rateHandle.close();
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});