import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { AuthUser, UserTeamMembership } from '../auth/can.js';
import { getJwtSecret } from '../controllers/authController.js';

// Extend Express Request interface to include our strongly-typed user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Authentication middleware for Workdesk.
 * 
 * Extracts and verifies the HS256 JWT from the Authorization header: `Bearer <token>`.
 * Reads sub (the user id) from the verified token, loads user and team memberships,
 * and attaches req.user.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication token is required. Please sign in.',
    });
    return;
  }

  const token = authHeader.substring(7).trim();

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { sub: string };

    if (!decoded.sub) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid token structure.',
      });
      return;
    }

    const userId = decoded.sub;

    // Load user profile from database
    const userResult = await pool.query<{
      id: string;
      name: string;
      email: string;
      is_admin: boolean;
    }>('SELECT id, name, email, is_admin FROM users WHERE id = $1', [userId]);

    if (userResult.rowCount === 0) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User account not found.',
      });
      return;
    }

    const dbUser = userResult.rows[0];

    // Load user's team memberships
    const membershipResult = await pool.query<UserTeamMembership>(
      'SELECT team_id, role FROM team_memberships WHERE user_id = $1',
      [userId]
    );

    req.user = {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      is_admin: dbUser.is_admin,
      memberships: membershipResult.rows,
    };

    next();
  } catch (err: any) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired token.',
    });
  }
}
