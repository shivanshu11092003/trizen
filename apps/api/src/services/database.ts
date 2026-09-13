import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from '../db/schema.js';
import type { Env } from '../types.js';

export type Database = PostgresJsDatabase<typeof schema> & { $client: Sql };

/**
 * Supabase's transaction pooler is designed for short-lived edge workloads.
 * Prepared statements must stay disabled in transaction mode. Each request owns
 * its client because Worker TCP sockets cannot be reused across requests.
 */
export function databaseFor(env: Pick<Env, 'DATABASE_URL'>): Database {
  const client = postgres(env.DATABASE_URL, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 10,
  });
  return drizzle(client, { schema });
}

export async function closeDatabase(database: Database): Promise<void> {
  await database.$client.end({ timeout: 1 });
}
