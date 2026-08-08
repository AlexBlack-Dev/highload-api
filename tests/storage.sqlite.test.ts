import { beforeEach, describe, expect, it } from "vitest";
import { hashApiKey, randomApiKey } from "../src/lib/auth.js";
import { SqliteRepository } from "../src/lib/storage/sqlite.js";

describe("SqliteRepository", () => {
  let repo: SqliteRepository;

  beforeEach(() => {
    repo = new SqliteRepository(":memory:");
  });

  it("creates and reads back a key", async () => {
    const record = {
      id: "k1",
      name: "staging",
      hash: hashApiKey("hl_secret"),
      createdAt: 123,
      revoked: 0 as const,
    };
    await repo.createApiKey(record);
    const found = await repo.getApiKeyByHash(record.hash);
    expect(found).not.toBeNull();
    expect(found?.id).toBe("k1");
    expect(found?.name).toBe("staging");
    expect(found?.revoked).toBe(0);
  });

  it("returns null for a missing hash", async () => {
    const found = await repo.getApiKeyByHash("nope");
    expect(found).toBeNull();
  });

  it("lists keys newest first", async () => {
    await repo.createApiKey({ id: "a", name: "a", hash: "h1", createdAt: 1, revoked: 0 });
    await repo.createApiKey({ id: "b", name: "b", hash: "h2", createdAt: 2, revoked: 1 });
    const keys = await repo.listApiKeys();
    expect(keys.length).toBe(2);
    expect(keys[0]?.id).toBe("b");
  });

  it("revokes a key and reports missing ones", async () => {
    await repo.createApiKey({ id: "a", name: "a", hash: "h1", createdAt: 1, revoked: 0 });
    const revoked = await repo.revokeApiKey("a");
    expect(revoked).toBe(true);
    const entry = await repo.getApiKeyById("a");
    expect(entry?.revoked).toBe(1);
    const missing = await repo.revokeApiKey("zzz");
    expect(missing).toBe(false);
  });

  it("hashApiKey is deterministic and different keys do not collide", () => {
    expect(hashApiKey("same")).toBe(hashApiKey("same"));
    expect(hashApiKey("one")).not.toBe(hashApiKey("two"));
    expect(randomApiKey().startsWith("hl_")).toBe(true);
    expect(randomApiKey()).not.toBe(randomApiKey());
  });
});