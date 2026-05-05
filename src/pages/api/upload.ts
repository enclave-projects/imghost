import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  isAllowedContentType,
  validateMagicBytes,
  generateR2Key,
  uploadToR2,
} from '../../lib/r2';
import { createImage, countRecentUploads } from '../../lib/db';

export const prerender = false;

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const RATE_LIMIT_PER_HOUR = 10;

export async function POST({ request, locals }: APIContext): Promise<Response> {
  if (!env?.DB || !env?.IMAGES_BUCKET) {
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const user = locals.user;
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: max 10 uploads per hour
  const recentCount = await countRecentUploads(env.DB, user.id);
  if (recentCount >= RATE_LIMIT_PER_HOUR) {
    return Response.json(
      { error: `Upload limit reached (${RATE_LIMIT_PER_HOUR}/hour). Please try again later.` },
      { status: 429 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }

  const contentType = file.type;
  if (!isAllowedContentType(contentType)) {
    return Response.json(
      { error: 'Unsupported file type. Allowed: JPEG, PNG, GIF, WebP, AVIF, SVG, BMP' },
      { status: 415 },
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { error: `File too large. Maximum size is ${MAX_SIZE_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  if (file.size === 0) {
    return Response.json({ error: 'File is empty' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();

  // Validate magic bytes to prevent MIME type spoofing
  if (!validateMagicBytes(buffer, contentType)) {
    return Response.json(
      { error: 'File content does not match declared type' },
      { status: 415 },
    );
  }

  const r2Key = generateR2Key(user.id, contentType);

  try {
    await uploadToR2(env.IMAGES_BUCKET, r2Key, buffer, contentType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Failed to upload file: ${msg}` }, { status: 500 });
  }

  let image;
  try {
    image = await createImage(
      env.DB,
      user.id,
      r2Key,
      file.name,
      contentType,
      file.size,
    );
  } catch {
    // Attempt cleanup of orphaned R2 object
    await env.IMAGES_BUCKET.delete(r2Key).catch(() => undefined);
    return Response.json({ error: 'Failed to save image metadata' }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const publicUrl = `${origin}/images/${r2Key}`;

  return Response.json({
    ok: true,
    image: {
      id: image.id,
      filename: image.filename,
      size: image.size,
      contentType: image.content_type,
      url: publicUrl,
      createdAt: image.created_at,
    },
  });
}
