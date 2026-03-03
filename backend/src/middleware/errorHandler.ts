import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      issues: err.issues
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      details: err.details
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error';
  res.status(500).json({
    status: 'error',
    message
  });
}

