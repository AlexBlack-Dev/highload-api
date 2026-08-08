import pg from "pg";
import type { ApiKeyRecord, Repository } from "./repository.js";

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  revoked SMALLINT NOT NULL DEFAULT 0
);
`;

interface KeyRow {
  id: string;
  name: string;
  hash: string;
  created_at: string;
  revoked: number;
}

function mapRow(row: KeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    hash: row.hash,
    createdAt: Number(row.created_at),
    revoked: row.revoked === 1 ? 1 : 0,
  };
}

export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async createApiKey(record: ApiKeyRecord): Promise<void> {
    await this.pool.query(
      "INSERT INTO api_keys (id, name, hash, created_at, revoked) VALUES ($1, $2, $3, $4, $5)",
      [record.id, record.name, record.hash, record.createdAt, record.revoked],
    );
  }

  async getApiKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    const res = await this.pool.query<KeyRow>(
      "SELECT id, name, hash, created_at, revoked FROM api_keys WHERE hash = $1",
      [hash],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async getApiKeyById(id: string): Promise<ApiKeyRecord | null> {
    const res = await this.pool.query<KeyRow>(
      "SELECT id, name, hash, created_at, revoked FROM api_keys WHERE id = $1",
      [id],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }

  async listApiKeys(): Promise<ApiKeyRecord[]> {
    const res = await this.pool.query<KeyRow>(
      "SELECT id, name, hash, created_at, revoked FROM api_keys ORDER BY created_at DESC",
    );
    return res.rows.map(mapRow);
  }

  async revokeApiKey(id: string): Promise<boolean> {
    const res = await this.pool.query(
      "UPDATE api_keys SET revoked = 1 WHERE id = $1",
      [id],
    );
    return res.rowCount != null && res.rowCount > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}