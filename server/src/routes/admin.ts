import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, getUnifiedApiKey } from '../db/index.js';

export const adminRouter = Router();

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

const send404 = (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.status(404).json({ error: { message: 'Organization management is not applicable to FreeLLMAPI', type: 'invalid_request_error' } });
};

adminRouter.get('/users', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], first_id: null, last_id: null, has_more: false });
});

adminRouter.get('/users/:id', send404);
adminRouter.post('/users/:id', send404);
adminRouter.delete('/users/:id', send404);

adminRouter.get('/invites', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});

adminRouter.post('/invites', send404);
adminRouter.get('/invites/:id', send404);
adminRouter.delete('/invites/:id', send404);

adminRouter.get('/projects', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});

adminRouter.post('/projects', send404);
adminRouter.get('/projects/:id', send404);
adminRouter.post('/projects/:id', send404);
adminRouter.post('/projects/:id/archive', send404);

adminRouter.get('/audit_logs', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});

adminRouter.get('/costs', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({});
});

adminRouter.get('/usage', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});

adminRouter.get('/usage/:category', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});

adminRouter.get('/usage/:category/:subcategory', (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  res.json({ object: 'list', data: [], has_more: false });
});
