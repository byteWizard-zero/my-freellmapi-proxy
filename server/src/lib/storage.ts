import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STORAGE_DIR = path.resolve(__dirname, '../../../data/files');

// Ensure local directory exists
if (!fsSync.existsSync(LOCAL_STORAGE_DIR)) {
  fsSync.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
}

export interface StorageResult {
  storagePath: string;
  bytes: number;
  isRemote?: boolean;
}

/**
 * Storage Driver for FreeLLMAPI
 * 
 * Supports:
 * 1. Local filesystem (default) under `server/data/files/`
 * 2. Cloudflare R2 / AWS S3 (when S3_BUCKET and S3_ENDPOINT are set)
 */
class StorageService {
  private isS3Configured: boolean;
  private s3Bucket?: string;
  private s3Endpoint?: string;
  private s3AccessKey?: string;
  private s3SecretKey?: string;

  constructor() {
    this.s3Bucket = process.env.S3_BUCKET;
    this.s3Endpoint = process.env.S3_ENDPOINT;
    this.s3AccessKey = process.env.S3_ACCESS_KEY_ID;
    this.s3SecretKey = process.env.S3_SECRET_ACCESS_KEY;
    this.isS3Configured = Boolean(this.s3Bucket && this.s3Endpoint && this.s3AccessKey && this.s3SecretKey);

    if (this.isS3Configured) {
      console.log(`[Storage] Configured with cloud storage bucket '${this.s3Bucket}' at endpoint '${this.s3Endpoint}'`);
    } else {
      console.log(`[Storage] Using local disk storage at ${LOCAL_STORAGE_DIR}`);
    }
  }

  getLocalStorageDir(): string {
    return LOCAL_STORAGE_DIR;
  }

  async saveFile(relativeKey: string, data: Buffer, contentType: string = 'application/octet-stream'): Promise<StorageResult> {
    if (this.isS3Configured) {
      try {
        await this.uploadToS3(relativeKey, data, contentType);
        return {
          storagePath: `s3://${this.s3Bucket}/${relativeKey}`,
          bytes: data.length,
          isRemote: true,
        };
      } catch (err: any) {
        console.warn(`[Storage] Cloud storage upload failed (${err.message}), falling back to local disk`);
      }
    }

    const localPath = path.resolve(LOCAL_STORAGE_DIR, relativeKey);
    const dir = path.dirname(localPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(localPath, data);

    return {
      storagePath: localPath,
      bytes: data.length,
      isRemote: false,
    };
  }

  async readFile(storagePath: string): Promise<Buffer> {
    if (storagePath.startsWith('s3://') && this.isS3Configured) {
      const relativeKey = storagePath.replace(`s3://${this.s3Bucket}/`, '');
      return await this.downloadFromS3(relativeKey);
    }

    // Default to local file read
    return await fs.readFile(storagePath);
  }

  async deleteFile(storagePath: string): Promise<boolean> {
    try {
      if (storagePath.startsWith('s3://') && this.isS3Configured) {
        const relativeKey = storagePath.replace(`s3://${this.s3Bucket}/`, '');
        await this.deleteFromS3(relativeKey);
        return true;
      }

      await fs.unlink(storagePath);
      return true;
    } catch {
      return false;
    }
  }

  // --- Lightweight AWS SigV4 implementation for Cloudflare R2 / S3 ---

  private async uploadToS3(key: string, data: Buffer, contentType: string): Promise<void> {
    const url = `${this.s3Endpoint?.replace(/\/+$/, '')}/${this.s3Bucket}/${key}`;
    const method = 'PUT';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const headers: Record<string, string> = {
      'host': new URL(url).host,
      'content-type': contentType,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': crypto.createHash('sha256').update(data).digest('hex'),
    };

    // Construct signature
    const authHeader = this.computeAuthHeader(method, url, headers, headers['x-amz-content-sha256'], amzDate, dateStamp);
    headers['Authorization'] = authHeader;

    const res = await fetch(url, {
      method,
      headers,
      body: data,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`S3 upload error ${res.status}: ${body}`);
    }
  }

  private async downloadFromS3(key: string): Promise<Buffer> {
    const url = `${this.s3Endpoint?.replace(/\/+$/, '')}/${this.s3Bucket}/${key}`;
    const method = 'GET';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const emptySha = crypto.createHash('sha256').update('').digest('hex');

    const headers: Record<string, string> = {
      'host': new URL(url).host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': emptySha,
    };

    headers['Authorization'] = this.computeAuthHeader(method, url, headers, emptySha, amzDate, dateStamp);

    const res = await fetch(url, { method, headers });
    if (!res.ok) {
      throw new Error(`S3 download error ${res.status}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async deleteFromS3(key: string): Promise<void> {
    const url = `${this.s3Endpoint?.replace(/\/+$/, '')}/${this.s3Bucket}/${key}`;
    const method = 'DELETE';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const emptySha = crypto.createHash('sha256').update('').digest('hex');

    const headers: Record<string, string> = {
      'host': new URL(url).host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': emptySha,
    };

    headers['Authorization'] = this.computeAuthHeader(method, url, headers, emptySha, amzDate, dateStamp);
    await fetch(url, { method, headers });
  }

  private computeAuthHeader(method: string, url: string, headers: Record<string, string>, payloadSha: string, amzDate: string, dateStamp: string): string {
    const parsedUrl = new URL(url);
    const canonicalUri = parsedUrl.pathname;
    const sortedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
    const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headers[k].trim()}\n`).join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      '', // query string
      canonicalHeaders,
      signedHeaders,
      payloadSha,
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = crypto.createHmac('sha256', `AWS4${this.s3SecretKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update('auto').digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `${algorithm} Credential=${this.s3AccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }
}

export const storage = new StorageService();
