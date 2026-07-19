import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getEnvPath(): string {
  // Check process.cwd and parent directories
  let curr = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(curr, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  // Check __dirname and parent directories
  curr = __dirname;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(curr, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  return path.resolve(process.cwd(), '.env');
}

export function saveUnifiedKeyToEnv(key: string) {
  try {
    const envPath = getEnvPath();
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const regex = /^UNIFIED_API_KEY=.*$/m;
    if (regex.test(content)) {
      content = content.replace(regex, `UNIFIED_API_KEY=${key}`);
    } else {
      if (content && !content.endsWith('\n') && content.length > 0) {
        content += '\n';
      }
      content += `UNIFIED_API_KEY=${key}\n`;
    }
    fs.writeFileSync(envPath, content, 'utf8');
    process.env.UNIFIED_API_KEY = key;
  } catch {
    // Ignore read-only filesystem errors
  }
}

dotenv.config({ path: getEnvPath() });
