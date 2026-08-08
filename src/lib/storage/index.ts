import type { Logger } from "pino";
import type { AppConfig } from "../../config.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./repository.js";
import { SqliteRepository } from "./sqlite.js";

export async function createRepository(
  config: AppConfig,
  log: Logger,
): Promise<Repository> {
  const dbUrl = config.DATABASE_URL;
  if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
    const repo = new PostgresRepository(dbUrl);
    await repo.init();
    log.info("storage: postgres");
    return repo;
  }
  if (dbUrl.startsWith("sqlite:")) {
    const filePath = dbUrl.slice("sqlite:".length);
    log.info({ filePath }, "storage: sqlite");
    return new SqliteRepository(filePath);
  }
  throw new Error(
    "DATABASE_URL must start with 'sqlite:' or 'postgres://' — got: " + dbUrl,
  );
}