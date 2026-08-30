import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { normalizeImage } from '../../lib/image-normalizer.js';

describe('Image Normalizer (Universal Format Support)', () => {
  it('normalizes a standard PNG buffer into clean base64 data URL', async () => {
    const pngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    }).png().toBuffer();

    const result = await normalizeImage(pngBuffer);
    expect(result.mimeType).toBe('image/png');
    expect(result.dataUrl).toContain('data:image/png;base64,');
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });

  it('transcodes a TIFF / BMP image into standard image/jpeg', async () => {
    const tiffBuffer = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: { r: 0, g: 128, b: 255 },
      },
    }).tiff().toBuffer();

    const tiffBase64 = `data:image/tiff;base64,${tiffBuffer.toString('base64')}`;
    const result = await normalizeImage(tiffBase64);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.dataUrl).toContain('data:image/jpeg;base64,');
    expect(result.width).toBe(120);
    expect(result.height).toBe(80);
  });

  it('resizes oversized images while maintaining aspect ratio', async () => {
    const hugeBuffer = await sharp({
      create: {
        width: 4000,
        height: 2000,
        channels: 3,
        background: { r: 50, g: 150, b: 50 },
      },
    }).jpeg().toBuffer();

    const result = await normalizeImage(hugeBuffer, 2048);
    expect(result.dataUrl).toContain('data:image/jpeg;base64,');

    const meta = await sharp(Buffer.from(result.base64, 'base64')).metadata();
    expect(meta.width).toBeLessThanOrEqual(2048);
    expect(meta.height).toBeLessThanOrEqual(2048);
  });
});
