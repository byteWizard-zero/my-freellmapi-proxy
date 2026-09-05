import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, getUnifiedApiKey } from '../db/index.js';

export const fineTuningRouter = Router();

function authenticateRequest(req: Request, res: Response): boolean {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const unifiedKey = getUnifiedApiKey();
    if (!token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(unifiedKey))) {
      res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
      return false;
    }
  }
  return true;
}

fineTuningRouter.post('/jobs', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({
    id: 'ftjob-none',
    object: 'fine_tuning.job',
    model: req.body.model || 'unknown',
    created_at: Math.floor(Date.now() / 1000),
    finished_at: null,
    fine_tuned_model: null,
    status: 'failed',
    error: {
      code: 'not_supported',
      message: 'Fine-tuning is not available on free-tier providers. Use a paid API for model training.',
      param: null
    },
    hyperparameters: {},
    training_file: req.body.training_file || '',
    validation_file: null,
    result_files: [],
    trained_tokens: 0,
    seed: 0
  });
});

fineTuningRouter.get('/jobs', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});

fineTuningRouter.get('/jobs/:id', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.status(404).json({ error: { message: 'Fine-tuning job not found', type: 'invalid_request_error' } });
});

fineTuningRouter.post('/jobs/:id/cancel', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.status(404).json({ error: { message: 'Fine-tuning job not found', type: 'invalid_request_error' } });
});

fineTuningRouter.get('/jobs/:id/events', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});

fineTuningRouter.get('/jobs/:id/checkpoints', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});
