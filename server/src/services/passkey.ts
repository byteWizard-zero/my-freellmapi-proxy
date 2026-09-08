import type { Request } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import { getDb } from '../db/index.js';

// In-memory challenge cache with 5-minute TTL
interface ChallengeRecord {
  challenge: string;
  userId?: number;
  expiresAt: number;
}

const challengeMap = new Map<string, ChallengeRecord>();

function cleanExpiredChallenges() {
  const now = Date.now();
  for (const [key, val] of challengeMap.entries()) {
    if (val.expiresAt < now) {
      challengeMap.delete(key);
    }
  }
}

export function getWebAuthnConfig(req: Request) {
  let origin = (req.headers.origin as string) || '';
  let host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost';
  host = host.split(':')[0]; // strip port

  if (!origin) {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    origin = `${proto}://${req.headers.host || 'localhost'}`;
  }

  const rpID = host;
  const expectedOrigin = [origin, 'http://localhost:5173', 'http://localhost:3001'].filter(Boolean);

  return { rpID, expectedOrigin, origin };
}

export async function generatePasskeyRegisterOptions(user: { id: number; email: string }, req: Request) {
  cleanExpiredChallenges();
  const { rpID } = getWebAuthnConfig(req);

  // Retrieve existing passkeys for user to prevent duplicate registrations
  const existingPasskeys = getDb()
    .prepare('SELECT id, transports FROM passkeys WHERE user_id = ?')
    .all(user.id) as { id: string; transports: string | null }[];

  const excludeCredentials = existingPasskeys.map((p) => ({
    id: p.id,
    transports: p.transports ? (JSON.parse(p.transports) as any) : undefined,
  }));

  const options = await generateRegistrationOptions({
    rpName: 'FreeLLMAPI',
    rpID,
    userName: user.email,
    userDisplayName: user.email,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Save challenge keyed by user ID
  const challengeKey = `reg_${user.id}`;
  challengeMap.set(challengeKey, {
    challenge: options.challenge,
    userId: user.id,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return options;
}

export async function verifyPasskeyRegistration(user: { id: number; email: string }, body: any, req: Request) {
  cleanExpiredChallenges();
  const challengeKey = `reg_${user.id}`;
  const record = challengeMap.get(challengeKey);

  if (!record || record.expiresAt < Date.now()) {
    challengeMap.delete(challengeKey);
    throw new Error('Registration challenge expired or invalid. Please try again.');
  }

  const { rpID, expectedOrigin } = getWebAuthnConfig(req);

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: record.challenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
  } catch (err: any) {
    throw new Error(err.message || 'Verification failed');
  }

  challengeMap.delete(challengeKey);

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Verification could not be verified.');
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // Insert passkey into SQLite
  const stmt = getDb().prepare(`
    INSERT INTO passkeys (id, user_id, public_key, counter, device_type, backed_up, transports)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    credential.id,
    user.id,
    Buffer.from(credential.publicKey),
    credential.counter,
    credentialDeviceType,
    credentialBackedUp ? 1 : 0,
    credential.transports ? JSON.stringify(credential.transports) : null,
  );

  return { verified: true };
}

export async function generatePasskeyLoginOptions(req: Request) {
  cleanExpiredChallenges();
  const { rpID } = getWebAuthnConfig(req);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
  });

  // Key challenge by challenge string itself so we can verify without requiring email beforehand
  challengeMap.set(`auth_${options.challenge}`, {
    challenge: options.challenge,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return options;
}

export async function verifyPasskeyLogin(body: any, req: Request) {
  cleanExpiredChallenges();

  // Look up matching credential in DB
  const passkey = getDb().prepare(`
    SELECT p.id, p.user_id, p.public_key, p.counter, p.transports, u.email
    FROM passkeys p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(body.id) as {
    id: string;
    user_id: number;
    public_key: Buffer;
    counter: number;
    transports: string | null;
    email: string;
  } | undefined;

  if (!passkey) {
    throw new Error('Passkey not recognized or not registered.');
  }

  // Look up challenge from challengeMap
  // SimpleWebAuthn clientDataJSON contains the challenge
  let expectedChallenge = '';
  try {
    const clientDataJSON = Buffer.from(body.response.clientDataJSON, 'base64').toString('utf8');
    const parsedClientData = JSON.parse(clientDataJSON);
    expectedChallenge = parsedClientData.challenge;
  } catch {
    throw new Error('Invalid client data.');
  }

  const challengeKey = `auth_${expectedChallenge}`;
  const record = challengeMap.get(challengeKey);
  if (!record || record.expiresAt < Date.now()) {
    challengeMap.delete(challengeKey);
    throw new Error('Authentication challenge expired or invalid.');
  }

  const { rpID, expectedOrigin } = getWebAuthnConfig(req);

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: record.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
    });
  } catch (err: any) {
    throw new Error(err.message || 'Passkey authentication failed');
  }

  challengeMap.delete(challengeKey);

  if (!verification.verified) {
    throw new Error('Passkey authentication could not be verified.');
  }

  // Update counter in DB
  getDb().prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(
    verification.authenticationInfo.newCounter,
    passkey.id,
  );

  return { id: passkey.user_id, email: passkey.email };
}

export function listPasskeys(userId: number) {
  return getDb().prepare(`
    SELECT id, device_type, backed_up, created_at
    FROM passkeys
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
}

export function deletePasskey(userId: number, passkeyId: string) {
  getDb().prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(passkeyId, userId);
}

export function hasAnyPasskeys(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM passkeys').get() as { count: number };
  return row.count > 0;
}
