import { Router } from 'express';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { createAuthToken } from '../../utils/authToken.js';
import { LoginSchema } from './auth.types.js';

export const authRouter = Router();

authRouter.post('/login', (req, res, next) => {
  try {
    const payload = LoginSchema.parse(req.body);
    if (
      payload.username !== env.AUTH_ADMIN_USERNAME ||
      payload.password !== env.AUTH_ADMIN_PASSWORD
    ) {
      res.status(401).json({
        status: 'error',
        message: 'Invalid credentials'
      });
      return;
    }

    const token = createAuthToken(payload.username);
    res.json({
      status: 'ok',
      data: {
        token,
        user: {
          username: payload.username,
          role: 'admin'
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({
    status: 'ok',
    data: {
      user: req.authUser
    }
  });
});

