import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

/** An error that maps directly to the API error envelope `{ error: { code, message, details } }`. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') => new AppError(400, code, message, details);
export const unauthorized = (message = 'Please sign in to continue.', code = 'UNAUTHORIZED') => new AppError(401, code, message);
export const forbidden = (message = 'You do not have permission to do this.', code = 'FORBIDDEN') => new AppError(403, code, message);
export const notFound = (message = 'Not found.', code = 'NOT_FOUND') => new AppError(404, code, message);
export const conflict = (message: string, details?: unknown, code = 'CONFLICT') => new AppError(409, code, message, details);
export const unavailable = (message: string, code = 'SERVICE_UNAVAILABLE') => new AppError(503, code, message);

export function zodToAppError(err: ZodError): AppError {
  const fields = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = fields[0];
  const message = first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid request.';
  return new AppError(400, 'VALIDATION_ERROR', message, { fields });
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No route for ${req.method} ${req.path}.`, 'ROUTE_NOT_FOUND'));
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let appErr: AppError;
  if (err instanceof AppError) appErr = err;
  else if (err instanceof ZodError) appErr = zodToAppError(err);
  else if (isBodyParserError(err)) appErr = badRequest('The request body is not valid JSON.', undefined, 'INVALID_JSON');
  else if (isMulterError(err)) appErr = multerToAppError(err);
  else {
    (req.log ?? logger).error({ err }, 'unhandled error');
    appErr = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
  }
  if (appErr.status >= 500 && err instanceof AppError) (req.log ?? logger).warn({ code: appErr.code }, appErr.message);
  res.status(appErr.status).json({
    error: { code: appErr.code, message: appErr.message, details: appErr.details ?? null },
  });
};

function isBodyParserError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed';
}

interface MulterLike {
  name: string;
  code: string;
  field?: string;
}

function isMulterError(err: unknown): err is MulterLike {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'MulterError';
}

function multerToAppError(err: MulterLike): AppError {
  if (err.code === 'LIMIT_FILE_SIZE') return new AppError(413, 'FILE_TOO_LARGE', 'The file is too large. The limit is 10 MB.');
  if (err.code === 'LIMIT_UNEXPECTED_FILE') return badRequest(`Unexpected file field "${err.field ?? ''}". Send the file as "file".`, undefined, 'UNEXPECTED_FILE');
  return badRequest('The upload could not be read.', { reason: err.code }, 'UPLOAD_FAILED');
}
