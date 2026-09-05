import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../db/index.js';

/**
 * Helper to calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Split text into chunks
 */
function chunkText(text: string, chunkSizeTokens: number = 800, overlapTokens: number = 200): string[] {
  // Simple approximation: 1 token ~= 4 chars
  const chunkSizeChars = chunkSizeTokens * 4;
  const overlapChars = overlapTokens * 4;
  
  if (text.length <= chunkSizeChars) {
    return [text];
  }

  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSizeChars, text.length);
    let chunk = text.slice(i, end);
    
    if (end < text.length) {
      const lastNewline = chunk.lastIndexOf('\n');
      const lastPeriod = chunk.lastIndexOf('.');
      const breakPoint = Math.max(lastNewline, lastPeriod);
      
      if (breakPoint > chunk.length / 2) {
        chunk = chunk.slice(0, breakPoint + 1);
        i += breakPoint + 1;
      } else {
        i += chunkSizeChars;
      }
    } else {
      i += chunkSizeChars;
    }
    
    chunks.push(chunk);
    
    if (i < text.length) {
      i -= overlapChars;
      if (i < 0) i = 0; 
    }
  }

  return chunks;
}

/**
 * Fetch embeddings from local API
 */
async function getEmbeddings(input: string | string[]): Promise<number[][]> {
  const port = process.env.PORT || 3001;
  const url = `http://localhost:${port}/v1/embeddings`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        model: 'text-embedding-3-small'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get embeddings: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as any;
    return data.data.map((item: any) => item.embedding);
  } catch (error) {
    console.error('Error fetching embeddings:', error);
    throw error;
  }
}

export async function indexFile(vectorStoreId: string, fileId: string): Promise<void> {
  const db = getDb();
  let fileRecord;
  try {
    fileRecord = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as any;
    if (!fileRecord || !fileRecord.storage_path) {
      throw new Error(`File ${fileId} not found or has no storage path`);
    }

    db.prepare(`UPDATE vector_store_files SET status = 'in_progress' WHERE vector_store_id = ? AND file_id = ?`).run(vectorStoreId, fileId);

    const ext = path.extname(fileRecord.filename).toLowerCase();
    let text = '';
    
    if (ext === '.pdf') {
      try {
        const pdfModule: any = await import('pdf-parse' as any);
        const pdfParse = pdfModule.default || pdfModule;
        const dataBuffer = await fs.readFile(fileRecord.storage_path);
        const data = await pdfParse(dataBuffer);
        text = data.text;
      } catch (err: any) {
        console.warn(`Could not parse PDF natively (${err.message}), falling back to text read`);
        text = await fs.readFile(fileRecord.storage_path, 'utf8');
      }
    } else {
      text = await fs.readFile(fileRecord.storage_path, 'utf8');
    }

    if (!text || text.trim() === '') {
      throw new Error('File content is empty');
    }

    const chunks = chunkText(text);
    
    const BATCH_SIZE = 10;
    const embeddings: number[][] = [];
    
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);
      const batchEmbeddings = await getEmbeddings(batchChunks);
      embeddings.push(...batchEmbeddings);
    }

    if (chunks.length !== embeddings.length) {
      throw new Error('Mismatch between chunks and embeddings count');
    }

    let totalUsageBytes = Buffer.byteLength(text, 'utf8');

    const insertChunk = db.prepare(`
      INSERT INTO vector_chunks (id, vector_store_id, file_id, chunk_index, content, embedding, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `vc_${crypto.randomUUID()}`;
        const tokenCount = Math.ceil(chunks[i].length / 4);
        insertChunk.run(
          chunkId,
          vectorStoreId,
          fileId,
          i,
          chunks[i],
          JSON.stringify(embeddings[i]),
          tokenCount
        );
      }

      db.prepare(`
        UPDATE vector_store_files 
        SET status = 'completed', usage_bytes = ?
        WHERE vector_store_id = ? AND file_id = ?
      `).run(totalUsageBytes, vectorStoreId, fileId);

      db.prepare(`
        UPDATE vector_stores 
        SET 
          usage_bytes = usage_bytes + ?,
          file_counts_in_progress = MAX(0, file_counts_in_progress - 1),
          file_counts_completed = file_counts_completed + 1
        WHERE id = ?
      `).run(totalUsageBytes, vectorStoreId);
    })();

  } catch (error: any) {
    console.error(`Error indexing file ${fileId} for vector store ${vectorStoreId}:`, error);
    try {
      db.prepare(`
        UPDATE vector_store_files 
        SET status = 'failed', last_error = ?
        WHERE vector_store_id = ? AND file_id = ?
      `).run(error.message || 'Unknown error', vectorStoreId, fileId);

      db.prepare(`
        UPDATE vector_stores 
        SET 
          file_counts_in_progress = MAX(0, file_counts_in_progress - 1),
          file_counts_failed = file_counts_failed + 1
        WHERE id = ?
      `).run(vectorStoreId);
    } catch (dbErr) {
      console.error('Error updating failure status in DB:', dbErr);
    }
  }
}

export async function searchVectorStore(vectorStoreId: string, query: string, topK: number = 10): Promise<{content: string, score: number}[]> {
  try {
    const queryEmbeddings = await getEmbeddings([query]);
    if (!queryEmbeddings || queryEmbeddings.length === 0) {
      throw new Error('Failed to get query embedding');
    }
    const queryVec = queryEmbeddings[0];

    const db = getDb();
    const chunks = db.prepare('SELECT content, embedding FROM vector_chunks WHERE vector_store_id = ?').all(vectorStoreId) as any[];

    const results = chunks.map(chunk => {
      let vec: number[];
      try {
        vec = JSON.parse(chunk.embedding);
      } catch {
        vec = [];
      }
      return {
        content: chunk.content,
        score: cosineSimilarity(queryVec, vec)
      };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  } catch (error) {
    console.error('Error searching vector store:', error);
    throw error;
  }
}
