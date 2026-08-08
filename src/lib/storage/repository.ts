export interface ApiKeyRecord {
  id: string;
  name: string;
  hash: string;
  createdAt: number;
  revoked: 0 | 1;
}

export interface Repository {
  createApiKey(record: ApiKeyRecord): Promise<void>;
  getApiKeyByHash(hash: string): Promise<ApiKeyRecord | null>;
  getApiKeyById(id: string): Promise<ApiKeyRecord | null>;
  listApiKeys(): Promise<ApiKeyRecord[]>;
  revokeApiKey(id: string): Promise<boolean>;
  close(): Promise<void>;
}