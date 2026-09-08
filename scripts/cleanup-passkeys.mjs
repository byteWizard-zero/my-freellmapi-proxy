import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const dbPath = process.env.DB_PATH || path.resolve(rootDir, 'server/data/freeapi.db');

if (!fs.existsSync(dbPath)) {
  console.log(`Database file not found at: ${dbPath}`);
  process.exit(0);
}

const db = new Database(dbPath);

// Ensure table exists
const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='passkeys'").get();
if (!tableExists) {
  console.log('Passkeys table does not exist in database yet.');
  process.exit(0);
}

const args = process.argv.slice(2);
const deleteAll = args.includes('--all') || args.includes('-a');

const allPasskeys = db.prepare('SELECT id, user_id, device_type, created_at FROM passkeys ORDER BY created_at DESC').all();

console.log(`Found ${allPasskeys.length} total passkey(s) in database.`);

if (allPasskeys.length === 0) {
  console.log('No passkeys found.');
  process.exit(0);
}

if (deleteAll) {
  const result = db.prepare('DELETE FROM passkeys').run();
  console.log(`Deleted all ${result.changes} passkey(s). You can now register fresh passkeys in the dashboard.`);
  process.exit(0);
}

// Group by user_id
const byUser = new Map();
for (const p of allPasskeys) {
  if (!byUser.has(p.user_id)) {
    byUser.set(p.user_id, []);
  }
  byUser.get(p.user_id).push(p);
}

let deletedCount = 0;
for (const [userId, userPasskeys] of byUser.entries()) {
  console.log(`\nUser ID ${userId}: ${userPasskeys.length} passkey(s) registered`);
  if (userPasskeys.length > 1) {
    const newest = userPasskeys[0];
    const duplicates = userPasskeys.slice(1);
    console.log(`  Keeping newest passkey: ${newest.id.slice(0, 12)}... (Created: ${newest.created_at})`);
    
    for (const dup of duplicates) {
      console.log(`  Deleting duplicate:     ${dup.id.slice(0, 12)}... (Created: ${dup.created_at})`);
      db.prepare('DELETE FROM passkeys WHERE id = ?').run(dup.id);
      deletedCount++;
    }
  } else {
    console.log(`  1 passkey registered: ${userPasskeys[0].id.slice(0, 12)}... (No duplicates)`);
  }
}

console.log(`\nCleanup complete. Removed ${deletedCount} duplicate passkey(s).`);
