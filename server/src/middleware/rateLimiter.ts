import { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Login rate limiter: 10 attempts per 15 minutes per IP and email.
 * Returns 429 TOO_MANY_REQUESTS when limit is exceeded.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  validate: false,
  keyGenerator: (req: Request): string => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    return `${ip}_${email}`;
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: 'TOO_MANY_REQUESTS',
      message: 'Too many login attempts. Please try again after 15 minutes.',
    });
  },
});
