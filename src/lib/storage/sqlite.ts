import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ApiKeyRecord, Repository } from "./repository.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
`;

function mapRow(row: {
  id: string;
  name: string;
  hash: string;
  created_at: number;
  revoked: number;
}): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    hash: row.hash,
    createdAt: row.created_at,
    revoked: row.revoked === 1 ? 1 : 0,
  };
}

export class SqliteRepository implements Repository {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    if (filePath !== ":memory:") {
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  createApiKey(record: ApiKeyRecord): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO api_keys (id, name, hash, created_at, revoked) VALUES (?, ?, ?, ?, ?)",
      )
      .run(record.id, record.name, record.hash, record.createdAt, record.revoked);
    return Promise.resolve();
  }

  getApiKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM api_keys WHERE hash = ?")
      .get(hash) as
      | {
          id: string;
          name: string;
          hash: string;
          created_at: number;
          revoked: number;
        }
      | undefined;
    return Promise.resolve(row ? mapRow(row) : null);
  }

  getApiKeyById(id: string): Promise<ApiKeyRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM api_keys WHERE id = ?")
      .get(id) as
      | {
          id: string;
          name: string;
          hash: string;
          created_at: number;
          revoked: number;
        }
      | undefined;
    return Promise.resolve(row ? mapRow(row) : null);
  }

  listApiKeys(): Promise<ApiKeyRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM api_keys ORDER BY created_at DESC")
      .all() as Array<{
      id: string;
      name: string;
      hash: string;
      created_at: number;
      revoked: number;
    }>;
    return Promise.resolve(rows.map(mapRow));
  }

  revokeApiKey(id: string): Promise<boolean> {
    const res = this.db
      .prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?")
      .run(id);
    return Promise.resolve(res.changes > 0);
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}