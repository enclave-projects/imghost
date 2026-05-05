const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/ogg': 'ogv',
};

const IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/avif', 'image/svg+xml', 'image/bmp',
]);

const VIDEO_CONTENT_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime',
  'video/x-msvideo', 'video/x-matroska', 'video/ogg',
]);

const ALLOWED_CONTENT_TYPES = new Set([...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES]);

// Per-plan limits now live in src/lib/plans.ts.
// These free-plan defaults are kept for backwards compatibility with callers
// that have not yet been migrated to read plan-aware limits.
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;   // 10 MB (free plan)
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;  // 100 MB (free plan)
export const STORAGE_LIMIT_BYTES  = 500 * 1024 * 1024;  // 500 MB (free plan)
export const STORAGE_WARN_RATIO   = 0.8;                // warn at 80%

// Magic bytes for each supported format
const MAGIC: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mime: 'image/avif', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: 'image/bmp', bytes: [0x42, 0x4d] },
  // MP4 / MOV / MKV share ISO base media format
  { mime: 'video/mp4',       bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: 'video/quicktime', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: 'video/x-matroska', bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { mime: 'video/webm',      bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { mime: 'video/x-msvideo', bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'video/ogg',       bytes: [0x4f, 0x67, 0x67, 0x53] },
];

export function isAllowedContentType(ct: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(ct);
}

export function isImageContentType(ct: string): boolean {
  return IMAGE_CONTENT_TYPES.has(ct);
}

export function isVideoContentType(ct: string): boolean {
  return VIDEO_CONTENT_TYPES.has(ct);
}

export function extFromContentType(ct: string): string {
  return CONTENT_TYPE_EXT[ct] ?? 'bin';
}

export function validateMagicBytes(
  buffer: ArrayBuffer,
  declaredContentType: string,
): boolean {
  // SVG is XML text – skip byte check, rely on content-type
  if (declaredContentType === 'image/svg+xml') return true;

  const bytes = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
  for (const { mime, bytes: magic, offset = 0 } of MAGIC) {
    if (mime !== declaredContentType) continue;
    const matches = magic.every((b, i) => bytes[offset + i] === b);
    if (matches) return true;
  }
  return false;
}

export function generateR2Key(userId: number, contentType: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  const ext = extFromContentType(contentType);
  return `${userId}/${uuid}.${ext}`;
}

export async function uploadToR2(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer,
  contentType: string,
): Promise<void> {
  await bucket.put(key, data, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
}

export async function getFromR2(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteFromR2(
  bucket: R2Bucket,
  key: string,
): Promise<void> {
  await bucket.delete(key);
}

export async function deleteManyFromR2(
  bucket: R2Bucket,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  // R2.delete supports up to 1000 keys per call
  const CHUNK = 1000;
  for (let i = 0; i < keys.length; i += CHUNK) {
    await bucket.delete(keys.slice(i, i + CHUNK));
  }
}
