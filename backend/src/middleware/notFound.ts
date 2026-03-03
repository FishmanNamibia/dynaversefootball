import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/httpError.js';

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, 'Route not found'));
}

