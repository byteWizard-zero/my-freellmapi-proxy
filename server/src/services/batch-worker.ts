import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getDb, getUnifiedApiKey } from '../db/index.js';

export async function processBatch(batchId: string): Promise<void> {
  const db = getDb();
  try {
    let batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId) as any;
    if (!batch) return;

    const inputFile = db.prepare('SELECT * FROM files WHERE id = ?').get(batch.input_file_id) as any;
    if (!inputFile) throw new Error('Input file not found');

    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE batches SET status = ?, in_progress_at = ? WHERE id = ?')
      .run('in_progress', now, batchId);

    const inputLines: string[] = (await fs.readFile(inputFile.storage_path, 'utf-8')).split('\n').filter(l => l.trim() !== '');
    const totalLines = inputLines.length;

    db.prepare('UPDATE batches SET request_counts_total = ? WHERE id = ?')
      .run(totalLines, batchId);

    const outDir = path.join(process.cwd(), 'data', 'files');
    await fs.mkdir(outDir, { recursive: true }).catch(() => {});
    
    const outputFileName = `batch_${batchId}_output.jsonl`;
    const errorFileName = `batch_${batchId}_error.jsonl`;
    const outputPath = path.join(outDir, outputFileName);
    const errorPath = path.join(outDir, errorFileName);
    
    let hasErrors = false;
    let completedCount = 0;
    let failedCount = 0;

    const port = process.env.PORT || 3001;
    const apiKey = getUnifiedApiKey();

    for (const line of inputLines) {
      // Check for cancellation
      batch = db.prepare('SELECT status FROM batches WHERE id = ?').get(batchId) as any;
      if (batch.status === 'cancelling' || batch.status === 'cancelled') {
        db.prepare('UPDATE batches SET status = ?, cancelled_at = ? WHERE id = ?')
          .run('cancelled', Math.floor(Date.now() / 1000), batchId);
        return;
      }

      let parsedLine;
      try {
        parsedLine = JSON.parse(line);
      } catch (e) {
        failedCount++;
        hasErrors = true;
        await fs.appendFile(errorPath, JSON.stringify({ error: 'Invalid JSON line format' }) + '\n');
        continue;
      }

      const { custom_id, method, url, body } = parsedLine;

      try {
        const response = await fetch(`http://localhost:${port}${url}`, {
          method: method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(body)
        });

        const status_code = response.status;
        const responseJson = (await response.json().catch(() => ({}))) as any;

        if (!response.ok) {
          failedCount++;
          hasErrors = true;
          const errorLine = JSON.stringify({
            id: `response-${crypto.randomUUID()}`,
            custom_id,
            response: { status_code, request_id: crypto.randomUUID(), body: responseJson },
            error: responseJson.error || 'Request failed'
          }) + '\n';
          await fs.appendFile(errorPath, errorLine);
        } else {
          completedCount++;
          const successLine = JSON.stringify({
            id: `response-${crypto.randomUUID()}`,
            custom_id,
            response: { status_code, request_id: crypto.randomUUID(), body: responseJson },
            error: null
          }) + '\n';
          await fs.appendFile(outputPath, successLine);
        }
      } catch (e: any) {
        failedCount++;
        hasErrors = true;
        await fs.appendFile(errorPath, JSON.stringify({ custom_id, error: e.message }) + '\n');
      }

      db.prepare('UPDATE batches SET request_counts_completed = ?, request_counts_failed = ? WHERE id = ?')
        .run(completedCount, failedCount, batchId);
    }

    db.prepare('UPDATE batches SET status = ?, finalizing_at = ? WHERE id = ?')
      .run('finalizing', Math.floor(Date.now() / 1000), batchId);

    let outputFileId = null;
    let errorFileId = null;

    if (completedCount > 0 || totalLines === 0) {
      outputFileId = `file-${crypto.randomUUID()}`;
      const stat = await fs.stat(outputPath).catch(() => ({ size: 0 }));
      db.prepare(`INSERT INTO files (id, bytes, created_at, filename, purpose, status, storage_path)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(outputFileId, stat.size, Math.floor(Date.now() / 1000), outputFileName, 'batch.output', 'processed', outputPath);
    }

    if (hasErrors) {
      errorFileId = `file-${crypto.randomUUID()}`;
      const stat = await fs.stat(errorPath).catch(() => ({ size: 0 }));
      db.prepare(`INSERT INTO files (id, bytes, created_at, filename, purpose, status, storage_path)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(errorFileId, stat.size, Math.floor(Date.now() / 1000), errorFileName, 'batch.error', 'processed', errorPath);
    }

    db.prepare(`UPDATE batches 
                SET status = 'completed', completed_at = ?, output_file_id = ?, error_file_id = ? 
                WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000), outputFileId, errorFileId, batchId);

  } catch (error: any) {
    console.error(`Batch processing failed for ${batchId}:`, error);
    db.prepare(`UPDATE batches SET status = 'failed', failed_at = ?, errors = ? WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000), JSON.stringify([{ message: error.message }]), batchId);
  }
}
