import heic2any from 'heic2any';

export interface ProcessedImageResult {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  originalSize: number;
  processedSize: number;
}

/**
 * Universally processes and converts any image format (HEIC, HEIF, TIFF, BMP, SVG, WebP, PNG, JPEG, etc.)
 * into a standard web-compatible JPEG/PNG data URL that can be rendered in browsers and ingested by all AI vision models.
 */
export async function processUniversalImage(
  file: File | Blob,
  maxDimension = 2048,
  quality = 0.88,
): Promise<ProcessedImageResult> {
  const originalSize = file.size;
  const filename = (file as File).name || '';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const type = file.type?.toLowerCase() || '';

  const isHeic =
    ext === 'heic' ||
    ext === 'heif' ||
    type.includes('heic') ||
    type.includes('heif');

  let workingBlob: Blob = file;

  // 1. Convert HEIC/HEIF to JPEG Blob if needed
  if (isHeic) {
    try {
      const conversionResult = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality,
      });

      workingBlob = Array.isArray(conversionResult)
        ? conversionResult[0]
        : conversionResult;
    } catch (e: any) {
      console.warn('[ImageProcessor] heic2any conversion failed, attempting fallback canvas render:', e);
    }
  }

  // 2. Load into an Image element to normalize dimensions and transcode
  return new Promise<ProcessedImageResult>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(workingBlob);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      // Calculate resized dimensions if exceeding maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        // Fallback: direct FileReader
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            dataUrl: reader.result as string,
            mimeType: workingBlob.type || 'image/jpeg',
            width: img.width,
            height: img.height,
            originalSize,
            processedSize: workingBlob.size,
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(workingBlob);
        return;
      }

      // Fill white background for transparency conversion
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const targetMime = workingBlob.type === 'image/png' && !isHeic ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(targetMime, quality);
      const base64Len = dataUrl.length - (dataUrl.indexOf(',') + 1);
      const processedSize = Math.round((base64Len * 3) / 4);

      resolve({
        dataUrl,
        mimeType: targetMime,
        width,
        height,
        originalSize,
        processedSize,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Fallback: Read as raw Data URL
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          dataUrl: reader.result as string,
          mimeType: workingBlob.type || 'image/jpeg',
          width: 0,
          height: 0,
          originalSize,
          processedSize: workingBlob.size,
        });
      };
      reader.onerror = () => reject(new Error('Failed to load image into browser canvas'));
      reader.readAsDataURL(workingBlob);
    };

    img.src = objectUrl;
  });
}
