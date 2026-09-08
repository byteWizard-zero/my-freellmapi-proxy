import './env.js';
import { startLogging } from './services/logger.js';
startLogging();

import { createApp } from './app.js';
import { initDb } from './db/index.js';
import { startHealthChecker } from './services/health.js';
import { startKeepAlive } from './services/keepalive.js';
import { generateSetupCode } from './lib/setup-code.js';

const PORT = process.env.PORT ?? 3001;

async function main() {
  initDb();
  const app = createApp();

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Proxy endpoint: http://0.0.0.0:${PORT}/v1/chat/completions`);
    const code = generateSetupCode();
    console.log(`\n========================================`);
    console.log(`  Dashboard setup code: ${code}`);
    console.log(`  (Required for admin account setup)`);
    console.log(`========================================\n`);
    startHealthChecker();
    startKeepAlive();
  });
}

main().catch(console.error);
