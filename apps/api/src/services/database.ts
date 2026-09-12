import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '../db/schema.js';
import type { Env } from '../types.js';

export type Database = PostgresJsDatabase<typeof schema>;

let connectionUrl: string | undefined;
let client: Sql | undefined;
let database: Database | undefined;

/**
 * Supabase's transaction pooler is designed for short-lived edge workloads.
 * Prepared statements must stay disabled in transaction mode. The module-level
 * client is reused while a Worker isolate is warm and releases idle sockets.
 */
export function databaseFor(env: Pick<Env, 'DATABASE_URL'>): Database {
  if (!database || connectionUrl !== env.DATABASE_URL) {
    connectionUrl = env.DATABASE_URL;
    client = postgres(env.DATABASE_URL, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 60 * 10,
    });
    database = drizzle(client, { schema });
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  await client?.end({ timeout: 1 });
  connectionUrl = undefined;
  client = undefined;
  database = undefined;
}
