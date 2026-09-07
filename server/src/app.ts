import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { imagesRouter } from './routes/images.js';
import { audioRouter } from './routes/audio.js';
import { embeddingsRouter } from './routes/embeddings.js';
import { completionsRouter } from './routes/completions.js';
import { moderationsRouter } from './routes/moderations.js';
import { clientKeysRouter } from './routes/client-keys.js';
import { keysRouter } from './routes/keys.js';
import { modelsRouter } from './routes/models.js';
import { proxyRouter } from './routes/proxy.js';
import { fallbackRouter } from './routes/fallback.js';
import { analyticsRouter } from './routes/analytics.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { filesRouter } from './routes/files.js';
import { uploadsRouter } from './routes/uploads.js';
import { batchesRouter } from './routes/batches.js';
import { assistantsRouter } from './routes/assistants.js';
import { threadsRouter } from './routes/threads.js';
import { vectorStoresRouter } from './routes/vector-stores.js';
import { responsesRouter } from './routes/responses.js';
import { fineTuningRouter } from './routes/fine-tuning.js';
import { realtimeRouter } from './routes/realtime.js';
import { adminRouter } from './routes/admin.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { requireAuth } from './middleware/requireAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // CSP intentionally disabled — the SPA bundles inline styles and the OG
  // image is loaded from the same origin; enabling helmet's default CSP
  // breaks the React build's hashed-asset loader. HSTS off because this is
  // a single-user local proxy, served over HTTP on localhost. Both should
  // stay disabled unless someone serves the proxy over HTTPS publicly
  // (which is also not a supported deployment — see README).
  app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Auth routes (public — login, setup, status)
  app.use('/api/auth', authRouter);

  // Dashboard API routes — all require authentication
  app.use('/api/keys', requireAuth, keysRouter);
  app.use('/api/client-keys', requireAuth, clientKeysRouter);
  app.use('/api/models', requireAuth, modelsRouter);
  app.use('/api/fallback', requireAuth, fallbackRouter);
  app.use('/api/analytics', requireAuth, analyticsRouter);
  app.use('/api/health', requireAuth, healthRouter);
  app.use('/api/settings', requireAuth, settingsRouter);

  // OpenAI-compatible proxy & multimodal media routes
  app.use('/v1/embeddings', embeddingsRouter);
  app.use('/v1/completions', completionsRouter);
  app.use('/v1/moderations', moderationsRouter);
  app.use('/v1/images', imagesRouter);
  app.use('/v1/audio', audioRouter);
  app.use('/v1/files', filesRouter);
  app.use('/v1/uploads', uploadsRouter);
  app.use('/v1/batches', batchesRouter);
  app.use('/v1/assistants', assistantsRouter);
  app.use('/v1/threads', threadsRouter);
  app.use('/v1/vector_stores', vectorStoresRouter);
  app.use('/v1/responses', responsesRouter);
  app.use('/v1/fine_tuning', fineTuningRouter);
  app.use('/v1/realtime', realtimeRouter);
  app.use('/v1/organization', adminRouter);
  app.use('/v1', proxyRouter);

  // Health check
  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Error handler (for API routes)
  app.use(errorHandler);

  // Serve client static files (after API error handler)
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}
