import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  isAllowedContentType,
  isVideoContentType,
  validateMagicBytes,
  generateR2Key,
  uploadToR2,
} from '../../lib/r2';
import {
  createImage,
  countRecentUploads,
  getUserStorageUsed,
  getUserById,
  getFolderById,
} from '../../lib/db';
import { getPlan } from '../../lib/plans';

export const prerender = false;

function formatBytes(bytes: number): string {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

export async function POST({ request, locals }: APIContext): Promise<Response> {
  if (!env?.DB || !env?.IMAGES_BUCKET) {
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const user = locals.user;
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve user's plan-based limits
  const dbUser = await getUserById(env.DB, user.id);
  const plan = getPlan(dbUser?.plan);

  // Rate limit: uploads per rolling window (images + videos combined)
  const recentCount = await countRecentUploads(env.DB, user.id, plan.uploadWindowMinutes);
  if (recentCount >= plan.uploadsPerWindow) {
    const windowLabel = plan.uploadWindowMinutes === 60
      ? 'hour'
      : `${plan.uploadWindowMinutes} minutes`;
    return Response.json(
      { error: `Upload limit reached (${plan.uploadsPerWindow} per ${windowLabel}). Please try again later.` },
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

  const folderRaw = formData.get('folder_id');
  let folderId: number | null = null;
  if (typeof folderRaw === 'string' && folderRaw !== '' && folderRaw !== 'null') {
    const fid = parseInt(folderRaw, 10);
    if (!isNaN(fid)) {
      const folder = await getFolderById(env.DB, fid);
      if (!folder || folder.user_id !== user.id) {
        return Response.json({ error: 'Invalid folder' }, { status: 400 });
      }
      folderId = fid;
    }
  }

  if (file.size === 0) {
    return Response.json({ error: 'File is empty' }, { status: 400 });
  }

  const contentType = file.type;
  if (!isAllowedContentType(contentType)) {
    return Response.json(
      { error: 'Unsupported file type. Allowed images: JPEG, PNG, GIF, WebP, AVIF, SVG, BMP. Allowed videos: MP4, WebM, MOV, AVI, MKV, OGV' },
      { status: 415 },
    );
  }

  const isVideo = isVideoContentType(contentType);
  const mediaType = isVideo ? 'video' : 'image';
  const maxSize = isVideo ? plan.maxVideoBytes : plan.maxImageBytes;

  if (file.size > maxSize) {
    return Response.json(
      { error: `File too large. Maximum size for ${mediaType}s on the ${plan.name} plan is ${formatBytes(maxSize)}.` },
      { status: 413 },
    );
  }

  // Storage quota check
  const storageUsed = await getUserStorageUsed(env.DB, user.id);
  if (storageUsed + file.size > plan.storageBytes) {
    return Response.json(
      { error: `Storage quota exceeded. You have used ${formatBytes(storageUsed)} of your ${formatBytes(plan.storageBytes)} ${plan.name}-plan limit. Please delete some files or upgrade your plan.` },
      { status: 413 },
    );
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
      mediaType,
      folderId,
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
      mediaType: image.media_type,
      url: publicUrl,
      createdAt: image.created_at,
      folderId: image.folder_id ?? null,
    },
  });
}
