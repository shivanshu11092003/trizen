import { AppError, ErrorBody } from '@photos/shared';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppBindings } from '../types.js';
import { zodDetails } from './http.js';
import type { RouteConfig } from '@hono/zod-openapi';
import type { z } from 'zod';

export function apiRouter() {
  return new OpenAPIHono<AppBindings>({ defaultHook: (result) => {
    if (!result.success) throw new AppError('VALIDATION_FAILED', 'Some fields need attention.', { details: zodDetails(result.error) });
  } });
}

/** Every documented failure uses the same envelope, so the docs can't drift. */
export const err = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});

export const ok = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

export const jsonBody = <T extends z.ZodTypeAny>(schema: T, description?: string) => ({
  body: { content: { 'application/json': { schema } }, description, required: true },
});

/** Failures every authenticated route can produce. Spelled out so Redoc shows them. */
export const authErrors = {
  401: err('Not signed in, or the session was revoked.'),
  403: err('Signed in, but not allowed to do this.'),
} satisfies RouteConfig['responses'];

export const listErrors = {
  400: err('The cursor is malformed, tampered with, or was issued for a different sort order.'),
  422: err('A query parameter failed validation.'),
} satisfies RouteConfig['responses'];

export const sessionSecurity = [{ sessionAuth: [] }];
export const gallerySecurity = [{ galleryAuth: [] }];
