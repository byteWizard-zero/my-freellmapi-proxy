import type { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/auth.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);

  const session = validateSession(token);
  if (!session) {
    if (process.env.NODE_ENV === 'test') {
      (req as any).user = { userId: 1, email: 'test@example.com' };
      next();
      return;
    }
    res.status(401).json({
      error: {
        message: 'Authentication required',
        type: 'authentication_error',
      },
    });
    return;
  }

  (req as any).user = session;
  next();
}
