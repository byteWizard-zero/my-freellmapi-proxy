import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  listClientApiKeys,
  createClientApiKey,
  deleteClientApiKey,
  toggleClientApiKey,
} from '../db/index.js';

export const clientKeysRouter = Router();

const createClientKeySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  rateLimitRpm: z.number().int().positive().optional().default(60),
  monthlyTokenBudget: z.number().int().nonnegative().optional().default(1000000),
});

// GET /api/client-keys
clientKeysRouter.get('/', (_req: Request, res: Response) => {
  try {
    const keys = listClientApiKeys();
    res.json({ keys });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// POST /api/client-keys
clientKeysRouter.post('/', (req: Request, res: Response) => {
  const parsed = createClientKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: parsed.error.errors.map(e => e.message).join(', ') },
    });
    return;
  }

  try {
    const created = createClientApiKey(
      parsed.data.name,
      parsed.data.rateLimitRpm,
      parsed.data.monthlyTokenBudget,
    );
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// DELETE /api/client-keys/:id
clientKeysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid ID' } });
    return;
  }

  try {
    const deleted = deleteClientApiKey(id);
    if (!deleted) {
      res.status(404).json({ error: { message: 'Client API key not found' } });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// PATCH /api/client-keys/:id
clientKeysRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid ID' } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled boolean required' } });
    return;
  }

  try {
    const updated = toggleClientApiKey(id, enabled);
    if (!updated) {
      res.status(404).json({ error: { message: 'Client API key not found' } });
      return;
    }
    res.json({ success: true, enabled });
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message } });
  }
});
