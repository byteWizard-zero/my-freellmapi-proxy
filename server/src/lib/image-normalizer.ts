import sharp from 'sharp';

export interface NormalizedImageResult {
  mimeType: string;
  base64: string;
  dataUrl: string;
  width?: number;
  height?: number;
  format: string;
}

const SUPPORTED_LLM_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/**
 * Universally normalizes any image format (HEIC, HEIF, TIFF, BMP, SVG, AVIF, RAW, WebP, PNG, JPEG)
 * into a standard, optimized JPEG/PNG format supported across all LLM vision providers (Google Gemini, Groq, Mistral, Cloudflare, etc.).
 */
export async function normalizeImage(
  input: string | Buffer,
  maxDimension = 2048,
): Promise<NormalizedImageResult> {
  let buffer: Buffer;
  let originalMime = 'image/jpeg';

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      // Remote URL: fetch buffer
      const res = await fetch(trimmed);
      if (!res.ok) {
        throw new Error(`Failed to fetch remote image from ${trimmed} (HTTP ${res.status})`);
      }
      const arr = await res.arrayBuffer();
      buffer = Buffer.from(arr);
      originalMime = res.headers.get('content-type') || originalMime;
    } else {
      // Base64 Data URL or Raw Base64
      const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        originalMime = match[1].toLowerCase();
        buffer = Buffer.from(match[2], 'base64');
      } else {
        buffer = Buffer.from(trimmed, 'base64');
      }
    }
  } else {
    buffer = input;
  }

  try {
    const instance = sharp(buffer, { failOn: 'none' });
    const metadata = await instance.metadata();
    const detectedFormat = (metadata.format || 'jpeg').toLowerCase();

    let targetMime = originalMime;
    if (detectedFormat === 'heif' || detectedFormat === 'heic' || detectedFormat === 'tiff' || detectedFormat === 'bmp' || detectedFormat === 'svg' || detectedFormat === 'avif') {
      targetMime = 'image/jpeg';
    } else if (detectedFormat === 'png') {
      targetMime = 'image/png';
    } else if (detectedFormat === 'webp') {
      targetMime = 'image/webp';
    } else if (detectedFormat === 'gif') {
      targetMime = 'image/gif';
    } else if (detectedFormat === 'jpeg' || detectedFormat === 'jpg') {
      targetMime = 'image/jpeg';
    }

    // Force conversion if not in the standard set
    if (!SUPPORTED_LLM_MIME_TYPES.has(targetMime)) {
      targetMime = 'image/jpeg';
    }

    // Resize if exceeding maxDimension, maintaining aspect ratio
    let pipeline = sharp(buffer, { failOn: 'none' }).rotate(); // Auto-orient via EXIF
    if (metadata.width && metadata.height && (metadata.width > maxDimension || metadata.height > maxDimension)) {
      pipeline = pipeline.resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    let outputBuffer: Buffer;
    if (targetMime === 'image/png') {
      outputBuffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
    } else if (targetMime === 'image/webp') {
      outputBuffer = await pipeline.webp({ quality: 88 }).toBuffer();
    } else {
      // Flatten on white background in case of transparent alpha channels in JPEG conversion
      outputBuffer = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
      targetMime = 'image/jpeg';
    }

    const base64 = outputBuffer.toString('base64');
    return {
      mimeType: targetMime,
      base64,
      dataUrl: `data:${targetMime};base64,${base64}`,
      width: metadata.width,
      height: metadata.height,
      format: detectedFormat,
    };
  } catch (err: any) {
    console.warn('[ImageNormalizer] Sharp processing failed, returning raw base64:', err.message);
    const b64 = buffer.toString('base64');
    const safeMime = SUPPORTED_LLM_MIME_TYPES.has(originalMime) ? originalMime : 'image/jpeg';
    return {
      mimeType: safeMime,
      base64: b64,
      dataUrl: `data:${safeMime};base64,${b64}`,
      format: 'unknown',
    };
  }
}
