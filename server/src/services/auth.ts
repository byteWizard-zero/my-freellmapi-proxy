import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { randomBytes, createHash } from 'crypto';

export function userCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  return row.count;
}

export function createUser(email: string, password: string): { id: number; email: string } {
  const hashed = hashPassword(password);
  const info = getDb().prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(email, hashed);
  return { id: info.lastInsertRowid as number, email };
}

export function verifyCredentials(email: string, password: string): { id: number; email: string } | null {
  const user = getDb().prepare('SELECT id, email, password FROM users WHERE email = ? COLLATE NOCASE').get(email) as any;
  if (!user) return null;
  if (verifyPassword(password, user.password)) {
    return { id: user.id, email: user.email };
  }
  return null;
}

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, tokenHash, expiresAt);
  return token;
}

export function validateSession(token: string | undefined): { userId: number; email: string } | null {
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = getDb().prepare(`
    SELECT u.id as userId, u.email, s.expires_at 
    FROM sessions s 
    JOIN users u ON s.user_id = u.id 
    WHERE s.token_hash = ?
  `).get(tokenHash) as any;
  
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { userId: row.userId, email: row.email };
}

export function deleteSession(token: string): void {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function cleanExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

const bruteForceMap = new Map<string, { count: number; lockedUntil: number }>();

export function checkBruteForce(ip: string): boolean {
  const record = bruteForceMap.get(ip);
  if (!record) return false;
  if (record.count >= 5 && record.lockedUntil > Date.now()) {
    return true;
  }
  return false;
}

export function recordFailedLogin(ip: string): void {
  const record = bruteForceMap.get(ip) || { count: 0, lockedUntil: 0 };
  if (record.lockedUntil < Date.now()) {
    record.count = 0;
  }
  record.count++;
  if (record.count >= 5) {
    record.lockedUntil = Date.now() + 15 * 60 * 1000;
  }
  bruteForceMap.set(ip, record);
}

export function clearBruteForce(ip: string): void {
  bruteForceMap.delete(ip);
}
