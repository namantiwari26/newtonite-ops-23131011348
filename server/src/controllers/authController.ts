import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { UserTeamMembership } from '../auth/can.js';

// Pre-computed bcrypt hash (cost 10) to ensure constant-time response on non-existent accounts
const DUMMY_HASH = '$2b$10$wT0XkQ6B9mEfZF1j3hGvKe5NqG6x1JbFq1yF1fW8UvO4tT5r6aQe2';

/**
 * Validates that JWT_SECRET is configured and sufficiently long (>= 32 chars).
 * Refuses execution with an explicit error if missing or too short.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('JWT_SECRET environment variable is not defined. Server cannot start.');
  }
  const trimmed = secret.trim();
  if (trimmed.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long for security.');
  }
  return trimmed;
}

/**
 * Login endpoint: validates credentials and returns signed JWT.
 * POST /api/auth/login
 */
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;

  const sendUnauthorized = () => {
    res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  };

  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    sendUnauthorized();
    return;
  }

  try {
    // 1. Look up user by email
    const { rows } = await pool.query<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      is_admin: boolean;
    }>(
      'SELECT id, name, email, password_hash, is_admin FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    if (rows.length === 0) {
      // Execute dummy bcrypt.compare so execution time is indistinguishable from existing accounts
      await bcrypt.compare(password, DUMMY_HASH);
      sendUnauthorized();
      return;
    }

    const user = rows[0];

    // 2. Verify password with bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      sendUnauthorized();
      return;
    }

    // 3. Issue JWT: HS256, 8 hours, payload containing only sub
    const secret = getJwtSecret();
    const token = jwt.sign({ sub: user.id }, secret, { algorithm: 'HS256', expiresIn: '8h' });

    // 4. Fetch team memberships
    const { rows: memberships } = await pool.query<UserTeamMembership>(
      'SELECT team_id, role FROM team_memberships WHERE user_id = $1',
      [user.id]
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        is_admin: user.is_admin,
        memberships,
      },
    });
  } catch (err: any) {
    console.error('[Login Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Authentication failed' });
  }
}

/**
 * Current user profile endpoint
 * GET /api/auth/me
 */
export async function getCurrentUser(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
    return;
  }

  res.json({ user: req.user });
}
