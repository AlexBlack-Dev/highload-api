import { createHash, randomBytes, randomUUID } from "node:crypto";

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export function randomApiKey(): string {
  return `hl_${randomBytes(16).toString("base64url")}`;
}

export function randomId(): string {
  return randomUUID().slice(0, 8);
}

export function clientIp(req: { ip?: string; headers: { "x-forwarded-for"?: string } }): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]?.trim() ?? "unknown";
  }
  return req.ip ?? "unknown";
}