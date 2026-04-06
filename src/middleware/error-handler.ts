import type { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';
import { getLogger } from '../lib/logger';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const log = getLogger();
  if (createError.isHttpError(err)) {
    if (err.status >= 500) {
      log.error({ err }, 'HTTP 5xx');
    }
    res.status(err.status).json({ message: err.message });
    return;
  }
  log.error({ err }, 'Unhandled error');
  res.status(500).json({ message: 'Internal server error' });
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(createError(404, 'Not found'));
}
