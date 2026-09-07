import { Router } from 'express';
import { getDb } from '../db/index.js';
import { 
  userCount, createUser, verifyCredentials, 
  createSession, validateSession, deleteSession, 
  checkBruteForce, recordFailedLogin, clearBruteForce 
} from '../services/auth.js';
import { validateSetupCode, clearSetupCode } from '../lib/setup-code.js';
import { hashPassword } from '../lib/password.js';

export const authRouter = Router();

authRouter.get('/status', (req, res) => {
  const needsSetup = userCount() === 0;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);
  const authenticated = !!validateSession(token);
  res.json({ needsSetup, authenticated });
});

authRouter.post('/setup', (req, res) => {
  if (userCount() > 0) {
    res.status(409).json({ error: { message: 'Setup already completed', type: 'setup_complete' } });
    return;
  }

  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    if (!validateSetupCode(req.body.setupCode)) {
      res.status(403).json({ error: { message: 'Invalid setup code. Check server logs.', type: 'invalid_setup_code' } });
      return;
    }
  }

  const { email, password } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: { message: 'Invalid email', type: 'invalid_request' } });
    return;
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: { message: 'Password must be at least 8 characters', type: 'invalid_request' } });
    return;
  }

  const user = createUser(email, password);
  const token = createSession(user.id);
  clearSetupCode();

  res.json({ token, user });
});

authRouter.post('/login', (req, res) => {
  if (checkBruteForce(req.ip!)) {
    res.status(429).json({ error: { message: 'Too many failed attempts. Try again in 15 minutes.', type: 'rate_limit' } });
    return;
  }

  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: { message: 'Email and password required', type: 'invalid_request' } });
    return;
  }

  const user = verifyCredentials(email, password);
  if (!user) {
    recordFailedLogin(req.ip!);
    res.status(401).json({ error: { message: 'Invalid email or password', type: 'authentication_error' } });
    return;
  }

  clearBruteForce(req.ip!);
  const token = createSession(user.id);
  res.json({ token, user });
});

authRouter.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    deleteSession(token);
  }
  res.json({ success: true });
});

authRouter.post('/change-password', (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);
  const session = validateSession(token);
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: { message: 'Invalid request', type: 'invalid_request' } });
    return;
  }

  const user = verifyCredentials(session.email, currentPassword);
  if (!user) {
    res.status(401).json({ error: { message: 'Incorrect current password', type: 'authentication_error' } });
    return;
  }

  getDb().prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(newPassword), session.userId);
  res.json({ success: true });
});
