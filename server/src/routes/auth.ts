import { Router } from 'express';
import { getDb } from '../db/index.js';
import { 
  userCount, createUser, verifyCredentials, 
  createSession, validateSession, deleteSession, 
  checkBruteForce, recordFailedLogin, clearBruteForce 
} from '../services/auth.js';
import { validateSetupCode, clearSetupCode } from '../lib/setup-code.js';
import { generateResetCode, validateResetCode, clearResetCode } from '../lib/reset-code.js';
import { hashPassword } from '../lib/password.js';
import {
  generatePasskeyRegisterOptions,
  verifyPasskeyRegistration,
  generatePasskeyLoginOptions,
  verifyPasskeyLogin,
  listPasskeys,
  deletePasskey,
  hasAnyPasskeys,
} from '../services/passkey.js';
import { requireAuth } from '../middleware/requireAuth.js';

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

authRouter.post('/forgot-password', (req, res) => {
  if (userCount() === 0) {
    res.status(400).json({ error: { message: 'Setup not completed yet', type: 'setup_required' } });
    return;
  }

  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: { message: 'Valid email is required', type: 'invalid_request' } });
    return;
  }

  // Check if user exists (case-insensitive)
  const user = getDb().prepare('SELECT id, email FROM users WHERE email = ? COLLATE NOCASE').get(email) as any;
  if (user) {
    generateResetCode(user.email);
  }

  // Always return success to avoid leaking account existence, but log code if found
  res.json({ success: true, message: 'If this email is registered, a 6-character reset code was logged to the server logs.' });
});

authRouter.post('/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    res.status(400).json({ error: { message: 'Email, reset code, and new password are required', type: 'invalid_request' } });
    return;
  }

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: { message: 'Password must be at least 8 characters', type: 'invalid_request' } });
    return;
  }

  if (!validateResetCode(email, code)) {
    res.status(400).json({ error: { message: 'Invalid or expired reset code. Please check your server logs or request a new code.', type: 'invalid_code' } });
    return;
  }

  const user = getDb().prepare('SELECT id, email FROM users WHERE email = ? COLLATE NOCASE').get(email) as any;
  if (!user) {
    res.status(400).json({ error: { message: 'User not found', type: 'not_found' } });
    return;
  }

  // Update password
  getDb().prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(newPassword), user.id);

  // Invalidate any previous sessions
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

  clearResetCode();

  // Create new session token and return
  const token = createSession(user.id);
  res.json({ token, user: { id: user.id, email: user.email } });
});

// WebAuthn Passkeys endpoints
authRouter.get('/webauthn/has-passkeys', (_req, res) => {
  res.json({ hasPasskeys: hasAnyPasskeys() });
});

authRouter.post('/webauthn/login-options', async (req, res) => {
  try {
    const options = await generatePasskeyLoginOptions(req);
    res.json(options);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'webauthn_error' } });
  }
});

authRouter.post('/webauthn/login-verify', async (req, res) => {
  try {
    const user = await verifyPasskeyLogin(req.body, req);
    const token = createSession(user.id);
    res.json({ token, user });
  } catch (err: any) {
    res.status(400).json({ error: { message: err.message, type: 'webauthn_error' } });
  }
});

authRouter.post('/webauthn/register-options', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const options = await generatePasskeyRegisterOptions({ id: user.userId, email: user.email }, req);
    res.json(options);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'webauthn_error' } });
  }
});

authRouter.post('/webauthn/register-verify', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const result = await verifyPasskeyRegistration({ id: user.userId, email: user.email }, req.body, req);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: { message: err.message, type: 'webauthn_error' } });
  }
});

authRouter.get('/webauthn/passkeys', requireAuth, (req, res) => {
  const user = (req as any).user;
  const passkeys = listPasskeys(user.userId);
  res.json({ passkeys });
});

authRouter.delete('/webauthn/passkeys/:id', requireAuth, (req, res) => {
  const user = (req as any).user;
  deletePasskey(user.userId, req.params.id as string);
  res.json({ success: true });
});
