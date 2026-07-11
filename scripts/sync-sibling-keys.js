import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const rootDir = path.resolve(__dirname, '..');
const dbPath = path.resolve(rootDir, 'server/data/freeapi.db');
const parentDir = path.resolve(rootDir, '..');

function getUnifiedKey() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}`);
  }
  const db = new Database(dbPath);
  const row = db.prepare("SELECT value FROM settings WHERE key = 'unified_api_key'").get();
  db.close();
  if (!row) {
    throw new Error('Unified API key setting not found in database.');
  }
  return row.value;
}

function syncKeys() {
  try {
    const activeKey = getUnifiedKey();
    console.log(`\x1b[32m✔ Loaded active unified API key from database:\x1b[0m ${activeKey.slice(0, 15)}...\n`);

    // Scan all directories sibling to freellmapi
    const items = fs.readdirSync(parentDir);
    let updatedCount = 0;

    for (const item of items) {
      const fullPath = path.join(parentDir, item);
      if (!fs.statSync(fullPath).isDirectory() || item === 'freellmapi') {
        continue;
      }

      const envPath = path.join(fullPath, '.env');
      if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, 'utf8');
        let updated = false;

        // Match environment variables representing the proxy API key
        const targets = ['OPENAI_API_KEY', 'UNIFIED_API_KEY', 'PROXY_API_KEY', 'FREELLMAPI_KEY'];
        for (const target of targets) {
          const regex = new RegExp(`^(${target}\\s*=\\s*).*$`, 'm');
          if (regex.test(content)) {
            content = content.replace(regex, `$1${activeKey}`);
            updated = true;
          }
        }

        if (updated) {
          fs.writeFileSync(envPath, content, 'utf8');
          console.log(`\x1b[36m✔ Updated .env in sibling:\x1b[0m ${item}`);
          updatedCount++;
        }
      }
    }

    if (updatedCount === 0) {
      console.log('\x1b[33m⚠ Checked sibling directories. No active .env files with matching API key variable names were found.\x1b[0m');
      console.log('To sync a sibling repo, ensure it has a .env file with one of: OPENAI_API_KEY, UNIFIED_API_KEY, PROXY_API_KEY.');
    } else {
      console.log(`\n\x1b[32m✔ Successfully updated ${updatedCount} sibling repositories!\x1b[0m`);
    }

  } catch (error) {
    console.error('\x1b[31m✖ Error running sync script:\x1b[0m', error.message);
  }
}

syncKeys();
