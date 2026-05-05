const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

const ALLOWED_CONTENT_TYPES = new Set(Object.keys(CONTENT_TYPE_EXT));

// Magic bytes for each supported format
const MAGIC: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  { mime: 'image/avif', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  { mime: 'image/bmp', bytes: [0x42, 0x4d] },
];

export function isAllowedContentType(ct: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(ct);
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
