/** Stable machine codes. The frontend switches on these; humans read `message`. */
export const ErrorCode = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INVALID_CURSOR: 400,
  PIN_INVALID: 401,
  PIN_LOCKED: 429,
  GALLERY_EXPIRED: 410,
  GALLERY_NOT_PUBLISHED: 404,
  DOWNLOAD_DISABLED: 403,
  UPLOAD_FAILED: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  CSRF_FAILED: 403,
  INTERNAL: 500,
} as const;

export type ErrorCodeName = keyof typeof ErrorCode;

export type ErrorDetail = { path: string; message: string };

export class AppError extends Error {
  readonly code: ErrorCodeName;
  readonly status: number;
  readonly details?: ErrorDetail[];
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCodeName,
    message: string,
    opts: { details?: ErrorDetail[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ErrorCode[code];
    this.details = opts.details;
    this.headers = opts.headers;
  }
}

/** Thrown by the cursor codec; separate class so the codec has no API deps. */
export class InvalidCursorError extends AppError {
  constructor(message: string) {
    super('INVALID_CURSOR', message);
    this.name = 'InvalidCursorError';
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
