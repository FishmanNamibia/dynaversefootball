import crypto from 'node:crypto';
import { env } from '../config/env.js';

type TokenPayload = {
  sub: string;
  role: 'admin';
  exp: number;
};

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64url');
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf-8');
}

function sign(content: string): string {
  return crypto.createHmac('sha256', env.AUTH_TOKEN_SECRET).update(content).digest('base64url');
}

export function createAuthToken(subject: string): string {
  const payload: TokenPayload = {
    sub: subject,
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + env.AUTH_TOKEN_TTL_HOURS * 60 * 60
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token: string): TokenPayload | null {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = sign(encodedPayload);
  const providedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as TokenPayload;
  } catch {
    return null;
  }

  if (!payload.exp || Date.now() / 1000 > payload.exp) {
    return null;
  }
  if (payload.role !== 'admin' || !payload.sub) {
    return null;
  }
  return payload;
}
