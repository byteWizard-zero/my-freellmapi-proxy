import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const rootDir = path.resolve(__dirname, '..');
const dbPath = path.resolve(rootDir, 'server/data/freeapi.db');
const parentDir = path.resolve(rootDir, '../..');

// Excluded directories to speed up scanning and avoid node_modules/git noise
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.venv',
  'venv',
  'env',
]);

function isSubdirectory(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

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

// Recursively find env files up to a maximum depth
function findEnvFiles(dir, currentDepth = 1, maxDepth = 4) {
  let results = [];
  if (currentDepth > maxDepth) return results;

  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const baseName = path.basename(fullPath);
        if (EXCLUDED_DIRS.has(baseName)) continue;
        if (isSubdirectory(rootDir, fullPath)) continue;
        results = results.concat(findEnvFiles(fullPath, currentDepth + 1, maxDepth));
      } else {
        const baseName = path.basename(fullPath);
        if (
          baseName === '.env' ||
          baseName === '.env.local' ||
          baseName === '.env.development' ||
          baseName === '.env.production'
        ) {
          results.push(fullPath);
        }
      }
    }
  } catch (err) {
    // Ignore permissions errors or read errors
  }
  return results;
}

function syncKeys() {
  try {
    const activeKey = getUnifiedKey();
    console.log(`\x1b[32m✔ Loaded active unified API key from database:\x1b[0m ${activeKey.slice(0, 15)}...\n`);
    console.log(`Scanning sibling repositories under: ${parentDir}...\n`);

    const envFiles = findEnvFiles(parentDir);
    let updatedCount = 0;

    if (envFiles.length === 0) {
      console.log('\x1b[31m✖ No .env or .env.local files found in sibling directories.\x1b[0m');
      return;
    }

    console.log(`Found ${envFiles.length} env file(s). Inspecting variables...\n`);

    const targets = [
      'OPENAI_API_KEY',
      'UNIFIED_API_KEY',
      'PROXY_API_KEY',
      'FREELLMAPI_KEY',
      'PROXY_API_TOKEN',
      'LLM_API_KEY',
      'LLM_KEY',
      'PROXY_TOKEN'
    ];

    for (const envPath of envFiles) {
      const relativePath = path.relative(parentDir, envPath);
      let content = fs.readFileSync(envPath, 'utf8');
      let matchedVars = [];
      let updated = false;

      for (const target of targets) {
        const regex = new RegExp(`^(${target}\\s*=\\s*).*$`, 'm');
        if (regex.test(content)) {
          content = content.replace(regex, `$1${activeKey}`);
          matchedVars.push(target);
          updated = true;
        }
      }

      if (updated) {
        fs.writeFileSync(envPath, content, 'utf8');
        console.log(`\x1b[32m✔ Updated [${matchedVars.join(', ')}] in:\x1b[0m ${relativePath}`);
        updatedCount++;
      } else {
        console.log(`\x1b[90mℹ No matching variables in:\x1b[0m ${relativePath}`);
      }
    }

    console.log('\n------------------------------------------------');
    if (updatedCount === 0) {
      console.log('\x1b[33m⚠ No matching variables were found in any scanned env files.\x1b[0m');
      console.log('Supported variable names: ' + targets.join(', '));
      console.log('To sync a sibling repo, add one of these variables to its env file.');
    } else {
      console.log(`\x1b[32m✔ Success: Synchronized ${updatedCount} env file(s)!\x1b[0m`);
    }

  } catch (error) {
    console.error('\x1b[31m✖ Error running sync script:\x1b[0m', error.message);
  }
}

syncKeys();
