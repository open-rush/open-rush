import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

let _client: ReturnType<typeof postgres> | null = null;
let _db: DbClient | null = null;
let _url: string | null = null;

export function parsePoolMax(raw: string | undefined): number {
  if (!raw) return 10;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return 10;
  return Math.min(n, 100);
}

export function formatDatabaseUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
  }
}

export function getDbClient(connectionString?: string): DbClient {
  const url = connectionString || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set and no connection string provided');
  }

  if (_db) {
    if (_url && _url !== url) {
      throw new Error(
        `getDbClient called with different URL. Existing: ${formatDatabaseUrlForLog(_url)}, Requested: ${formatDatabaseUrlForLog(url)}. Call closeDbClient() first.`
      );
    }
    return _db;
  }

  _url = url;
  _client = postgres(url, {
    max: parsePoolMax(process.env.DB_POOL_MAX),
    idle_timeout: 30,
    connect_timeout: 10,
  });

  _db = drizzle(_client, { schema });
  return _db;
}

export async function closeDbClient(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
    _url = null;
  }
}
