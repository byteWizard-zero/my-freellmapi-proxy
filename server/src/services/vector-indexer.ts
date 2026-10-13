import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { EmbeddingRouter } from './embedding-router.js';

// In-memory cache for parsed vector float arrays by chunk ID to avoid JSON.parse overhead
const parsedVectorCache = new Map<string, number[]>();
const MAX_VECTOR_CACHE_SIZE = 50000;

/**
 * Retrieves a parsed vector float array from cache or parses JSON if not cached.
 */
export function getCachedVector(chunkId: string, embeddingJson: string): number[] {
  const cached = parsedVectorCache.get(chunkId);
  if (cached !== undefined) {
    return cached;
  }

  let vec: number[];
  try {
    vec = JSON.parse(embeddingJson);
    if (!Array.isArray(vec)) vec = [];
  } catch {
    vec = [];
  }

  if (parsedVectorCache.size >= MAX_VECTOR_CACHE_SIZE) {
    const oldestKey = parsedVectorCache.keys().next().value;
    if (oldestKey) parsedVectorCache.delete(oldestKey);
  }

  parsedVectorCache.set(chunkId, vec);
  return vec;
}

/**
 * Clears the in-memory parsed vector cache.
 */
export function clearVectorCache(): void {
  parsedVectorCache.clear();
}

/**
 * Helper to calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
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

export const DEFAULT_SPLITTER_SEPARATORS = [
  '\n```\n',
  '```\n',
  '```',
  '\n\n',
  '\n',
  '. ',
  '? ',
  '! ',
  '; ',
  '.',
  '!',
  '?',
  ' ',
  '',
];

export interface TextSplitterOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

/**
 * Advanced RecursiveTextSplitter splitting hierarchically by code blocks,
 * paragraphs, lines, and sentence terminators while preserving chunk size and overlap.
 */
export function recursiveTextSplitter(
  text: string,
  options: TextSplitterOptions = {}
): string[] {
  const chunkSize = options.chunkSize ?? 3200; // ~800 tokens
  const chunkOverlap = options.chunkOverlap ?? 800; // ~200 tokens
  const separators = options.separators ?? DEFAULT_SPLITTER_SEPARATORS;

  if (!text || text.trim().length === 0) {
    return [];
  }

  return splitTextInternal(text, separators, chunkSize, chunkOverlap);
}

function splitTextInternal(
  text: string,
  separators: string[],
  chunkSize: number,
  chunkOverlap: number
): string[] {
  if (text.length <= chunkSize) {
    const trimmed = text.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  // Find the highest priority separator present in the text
  let chosenSeparator = '';
  let nextSeparators: string[] = [];

  for (let i = 0; i < separators.length; i++) {
    const s = separators[i];
    if (s === '') {
      chosenSeparator = '';
      nextSeparators = [];
      break;
    }
    if (text.includes(s)) {
      chosenSeparator = s;
      nextSeparators = separators.slice(i + 1);
      break;
    }
  }

  // Split text by the chosen separator
  let rawSplits: string[];
  if (chosenSeparator === '') {
    rawSplits = Array.from(text);
  } else {
    rawSplits = text.split(chosenSeparator);
  }

  // Recursively split any chunk that is individually larger than chunkSize
  const splits: string[] = [];
  for (const piece of rawSplits) {
    if (piece.length > chunkSize && nextSeparators.length > 0) {
      const subSplits = splitTextInternal(piece, nextSeparators, chunkSize, chunkOverlap);
      splits.push(...subSplits);
    } else {
      const trimmedPiece = piece.trim();
      if (trimmedPiece.length > 0 || chosenSeparator === '') {
        splits.push(trimmedPiece);
      }
    }
  }

  // Merge splits into chunks with chunkOverlap
  const chunks: string[] = [];
  let currentGroup: string[] = [];
  let currentLength = 0;

  const joinSep = (chosenSeparator === '' || chosenSeparator.includes('```'))
    ? '\n'
    : chosenSeparator;

  for (const piece of splits) {
    const pieceLen = piece.length;
    const sepLen = currentGroup.length > 0 ? joinSep.length : 0;

    if (currentLength + sepLen + pieceLen > chunkSize && currentGroup.length > 0) {
      const merged = currentGroup.join(joinSep).trim();
      if (merged.length > 0) {
        chunks.push(merged);
      }

      // Preserve overlap: keep pieces from the tail of currentGroup
      while (currentGroup.length > 0) {
        const groupTotal = currentGroup.join(joinSep).length;
        if (groupTotal <= chunkOverlap) {
          break;
        }
        currentGroup.shift();
      }

      // Ensure that remaining overlap + next piece doesn't exceed chunkSize
      while (currentGroup.length > 0) {
        const groupTotal = currentGroup.join(joinSep).length;
        if (groupTotal + joinSep.length + pieceLen <= chunkSize) {
          break;
        }
        currentGroup.shift();
      }

      currentLength = currentGroup.length > 0 ? currentGroup.join(joinSep).length : 0;
    }

    currentGroup.push(piece);
    currentLength = currentGroup.join(joinSep).length;
  }

  if (currentGroup.length > 0) {
    const merged = currentGroup.join(joinSep).trim();
    if (merged.length > 0) {
      chunks.push(merged);
    }
  }

  return chunks;
}

export class RecursiveTextSplitterClass {
  chunkSize: number;
  chunkOverlap: number;
  separators: string[];

  constructor(options: TextSplitterOptions = {}) {
    this.chunkSize = options.chunkSize ?? 3200;
    this.chunkOverlap = options.chunkOverlap ?? 800;
    this.separators = options.separators ?? DEFAULT_SPLITTER_SEPARATORS;
  }

  splitText(text: string): string[] {
    return recursiveTextSplitter(text, {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      separators: this.separators,
    });
  }
}

/**
 * Universal RecursiveTextSplitter function / class callable as a function or instantiated with options.
 */
export function RecursiveTextSplitter(
  textOrOptions?: string | TextSplitterOptions,
  optionsOrChunkSize?: TextSplitterOptions | number,
  chunkOverlap?: number,
  separators?: string[]
): any {
  if (typeof textOrOptions === 'string') {
    let opts: TextSplitterOptions = {};
    if (typeof optionsOrChunkSize === 'number') {
      opts.chunkSize = optionsOrChunkSize;
      if (typeof chunkOverlap === 'number') opts.chunkOverlap = chunkOverlap;
      if (Array.isArray(separators)) opts.separators = separators;
    } else if (typeof optionsOrChunkSize === 'object' && optionsOrChunkSize !== null) {
      opts = optionsOrChunkSize;
    }
    return recursiveTextSplitter(textOrOptions, opts);
  }
  return new RecursiveTextSplitterClass(textOrOptions);
}

(RecursiveTextSplitter as any).split = (text: string, opts?: TextSplitterOptions) => recursiveTextSplitter(text, opts);

/**
 * Backwards-compatible chunkText helper
 */
export function chunkText(text: string, chunkSizeTokens: number = 800, overlapTokens: number = 200): string[] {
  return recursiveTextSplitter(text, {
    chunkSize: chunkSizeTokens * 4,
    chunkOverlap: overlapTokens * 4,
  });
}

/**
 * Fetch embeddings directly in-process via EmbeddingRouter
 */
export async function getEmbeddings(input: string | string[]): Promise<number[][]> {
  try {
    const response = await EmbeddingRouter.generateEmbeddings({
      input,
      model: 'auto',
    });
    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('Error fetching embeddings via EmbeddingRouter:', error);
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
        // Pre-populate parsed vector cache
        if (parsedVectorCache.size < MAX_VECTOR_CACHE_SIZE) {
          parsedVectorCache.set(chunkId, embeddings[i]);
        }
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
    const chunks = db.prepare('SELECT id, content, embedding FROM vector_chunks WHERE vector_store_id = ?').all(vectorStoreId) as any[];

    const results = chunks.map(chunk => {
      const vec = chunk.id ? getCachedVector(chunk.id, chunk.embedding) : (() => {
        try { return JSON.parse(chunk.embedding); } catch { return []; }
      })();
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
