import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { UserTeamMembership } from '../auth/can.js';

/**
 * Validates that JWT_SECRET is configured in the environment.
 * Refuses execution with an explicit error if missing (no fallback default).
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('JWT_SECRET environment variable is not defined. Server cannot start.');
  }
  return secret.trim();
}

/**
 * Workdesk Enterprise Login Endpoint
 * 
 * 1. Looks up the user by email
 * 2. Compares password with bcrypt.compare against password_hash
 * 3. Returns 401 with generic "Invalid email or password" on any failure
 * 4. Signs a JWT with HS256, 8h expiration, containing only sub (the user id)
 * 
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
    const token = jwt.sign(
      { sub: user.id },
      secret,
      { algorithm: 'HS256', expiresIn: '8h' }
    );

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
