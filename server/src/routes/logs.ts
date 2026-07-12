import { Router } from 'express';
import type { Request, Response } from 'express';
import { logBuffer, addLogListener } from '../services/logger.js';

export const logsRouter = Router();

logsRouter.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Initial connection ping
  res.write(': ping\n\n');

  // Stream current in-memory history
  for (const entry of logBuffer) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  // Hook new logs listener
  const removeListener = addLogListener((entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  // SSE Keep-Alive Ping
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    removeListener();
  });
});
