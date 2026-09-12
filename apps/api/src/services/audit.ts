import { auditLog } from '../db/schema.js';
import { ulid } from '../lib/ids.js';
import type { AppBindings } from '../types.js';
import type { Context } from 'hono';

/**
 * Append-only record of who did what. Deliberately fire-and-forget on the
 * response path: an audit write must never be the reason a publish fails.
 */
export async function audit(
  c: Context<AppBindings>,
  entry: {
    action: string;
    eventId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await c.get('db').insert(auditLog).values({
      id: ulid(),
      actorId: c.get('session')?.userId ?? null,
      eventId: entry.eventId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      createdAt: Date.now(),
    });
  } catch (e) {
    console.error(JSON.stringify({ level: 'warn', message: 'audit write failed', action: entry.action }));
  }
}
