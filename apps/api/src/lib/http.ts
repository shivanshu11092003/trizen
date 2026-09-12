import { AppError, type ErrorDetail } from '@photos/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { AppBindings } from '../types.js';

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found.`);

/** Deliberately a 404: telling an outsider a resource exists is itself a leak. */
export const hidden = (what: string) => new AppError('NOT_FOUND', `${what} not found.`);

export const forbidden = (message: string) => new AppError('FORBIDDEN', message);

export function zodDetails(err: ZodError): ErrorDetail[] {
  return err.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message }));
}

/** One envelope for every failure, with a requestId that matches the logs. */
export function onError(err: Error, c: Context<AppBindings>): Response {
  const requestId = c.get('requestId') ?? 'unknown';

  if (err instanceof AppError) {
    const body = {
      error: { code: err.code, message: err.message, details: err.details, requestId },
    };
    return c.json(body, err.status as 400, err.headers);
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some fields need attention.',
          details: zodDetails(err),
          requestId,
        },
      },
      422,
    );
  }

  if (err instanceof HTTPException) {
    return c.json({ error: { code: 'INTERNAL', message: err.message, requestId } }, err.status);
  }

  // Never leak an internal message to the client; log it in full instead.
  console.error(JSON.stringify({ level: 'error', requestId, message: err.message, stack: err.stack }));
  return c.json(
    { error: { code: 'INTERNAL', message: 'Something failed on our side. Try again.', requestId } },
    500,
  );
}
