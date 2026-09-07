import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

export function hashPassword(password: string): string {
  const saltHex = randomBytes(32).toString('hex');
  const hashHex = scryptSync(password, saltHex, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${saltHex}$${hashHex}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
      return false;
    }
    const [, saltHex, hashHex] = parts;
    const derivedHash = scryptSync(password, saltHex, 64, { N: 16384, r: 8, p: 1 });
    const storedHash = Buffer.from(hashHex, 'hex');
    
    if (derivedHash.length !== storedHash.length) {
      return false;
    }
    return timingSafeEqual(derivedHash, storedHash);
  } catch {
    return false;
  }
}
