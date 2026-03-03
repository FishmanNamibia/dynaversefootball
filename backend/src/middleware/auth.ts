import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from '../utils/authToken.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        username: string;
        role: 'admin';
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({
      status: 'error',
      message: 'Missing bearer token'
    });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({
      status: 'error',
      message: 'Invalid or expired token'
    });
    return;
  }

  req.authUser = {
    username: payload.sub,
    role: payload.role
  };
  next();
}

