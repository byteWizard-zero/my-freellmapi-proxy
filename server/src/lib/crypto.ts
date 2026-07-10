import crypto from 'crypto';
import Database from 'better-sqlite3';

const ALGORITHM = 'aes-256-gcm';

let cachedKey: Buffer | null = null;

/**
 * AES-256-GCM uses a 32-byte key, hex-encoded as 64 chars.
 * A typo'd ENCRYPTION_KEY (e.g. "abc") would historically fall through
 * the placeholder check, get truncated to 1.5 bytes, and only fail at
 * the first encrypt() call with a cryptic node:crypto error. Validate
 * the length up front and fail fast with an actionable message.
 */
const KEY_BYTES = 32;
const KEY_HEX_LEN = KEY_BYTES * 2;

function parseHexKey(value: string, source: 'env' | 'db'): Buffer {
  if (value.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      `Invalid ENCRYPTION_KEY (${source}): expected ${KEY_HEX_LEN} hex chars (32 bytes), got ${value.length} chars. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(value, 'hex');
}

function migrateKeys(db: Database.Database, oldKey: Buffer, newKey: Buffer): void {
  // Check if there are keys in api_keys
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'").get();
  if (!tableCheck) return;

  const rows = db.prepare('SELECT id, platform, encrypted_key, iv, auth_tag FROM api_keys').all() as any[];
  if (rows.length === 0) return;

  const updateStmt = db.prepare('UPDATE api_keys SET encrypted_key = ?, iv = ?, auth_tag = ? WHERE id = ?');
  
  db.transaction(() => {
    for (const row of rows) {
      let decrypted: string | null = null;
      
      try {
        const decipher = crypto.createDecipheriv(ALGORITHM, oldKey, Buffer.from(row.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(row.auth_tag, 'hex'));
        let dec = decipher.update(row.encrypted_key, 'hex', 'utf8');
        dec += decipher.final('utf8');
        decrypted = dec;
      } catch (e) {
        try {
          const decipher = crypto.createDecipheriv(ALGORITHM, newKey, Buffer.from(row.iv, 'hex'));
          decipher.setAuthTag(Buffer.from(row.auth_tag, 'hex'));
          let dec = decipher.update(row.encrypted_key, 'hex', 'utf8');
          dec += decipher.final('utf8');
          // Already encrypted with new key
          continue;
        } catch (newKeyErr) {
          // Skip
        }
      }

      if (decrypted !== null) {
        const newIv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, newKey, newIv);
        let newEncrypted = cipher.update(decrypted, 'utf8', 'hex');
        newEncrypted += cipher.final('hex');
        const newAuthTag = cipher.getAuthTag().toString('hex');
        
        updateStmt.run(newEncrypted, newIv.toString('hex'), newAuthTag, row.id);
      }
    }
  })();
}

/**
 * Initialize encryption key from env, DB, or generate a new one.
 * Must be called after DB is initialized.
 */
export function initEncryptionKey(db: Database.Database): void {
  // 1. Check env var
  const envKey = process.env.ENCRYPTION_KEY;
  const hasEnvKey = envKey && envKey !== 'your-64-char-hex-key-here';

  // Check DB for persisted key
  const row = db.prepare("SELECT value FROM settings WHERE key = 'encryption_key'").get() as { value: string } | undefined;

  if (hasEnvKey) {
    const parsedEnvKey = parseHexKey(envKey, 'env');

    if (row) {
      const dbKeyStr = row.value;
      if (dbKeyStr !== envKey) {
        // Key changed/mismatches! Migrate stored keys to use the new key
        try {
          const parsedDbKey = parseHexKey(dbKeyStr, 'db');
          migrateKeys(db, parsedDbKey, parsedEnvKey);
          db.prepare("UPDATE settings SET value = ? WHERE key = 'encryption_key'").run(envKey);
          console.log('[Crypto] Successfully migrated database keys to use the new ENCRYPTION_KEY.');
        } catch (err: any) {
          console.warn('[Crypto] Warning during key migration:', err.message);
        }
      }
    } else {
      // First run with an env key, persist it for future checks
      db.prepare("INSERT INTO settings (key, value) VALUES ('encryption_key', ?)").run(envKey);
    }

    cachedKey = parsedEnvKey;
    return;
  }

  // 2. Check DB for persisted key
  if (row) {
    cachedKey = parseHexKey(row.value, 'db');
    return;
  }

  // 3. Generate and persist
  cachedKey = crypto.randomBytes(KEY_BYTES);
  db.prepare("INSERT INTO settings (key, value) VALUES ('encryption_key', ?)").run(cachedKey.toString('hex'));
}

function getEncryptionKey(): Buffer {
  if (!cachedKey) {
    throw new Error('Encryption key not initialized. Call initEncryptionKey() first.');
  }
  return cachedKey;
}

export function encrypt(text: string): { encrypted: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****' + key.slice(-4);
  return key.slice(0, 4) + '...' + key.slice(-4);
}
