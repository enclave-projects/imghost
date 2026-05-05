import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { getImageById, deleteImage, moveImagesToFolder, getFolderById } from '../../../lib/db';
import { deleteFromR2 } from '../../../lib/r2';

export const prerender = false;

export async function DELETE({ params, locals }: APIContext): Promise<Response> {
  if (!env?.DB || !env?.IMAGES_BUCKET) {
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const user = locals.user;
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = parseInt(params.id ?? '', 10);
  if (isNaN(id)) {
    return Response.json({ error: 'Invalid image ID' }, { status: 400 });
  }

  // Fetch image to verify ownership and get R2 key
  const image = await getImageById(env.DB, id);
  if (!image) {
    return Response.json({ error: 'Image not found' }, { status: 404 });
  }
  if (image.user_id !== user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Delete from R2 first, then from D1
  try {
    await deleteFromR2(env.IMAGES_BUCKET, image.r2_key);
  } catch {
    return Response.json({ error: 'Failed to delete file from storage' }, { status: 500 });
  }

  const deleted = await deleteImage(env.DB, id, user.id);
  if (!deleted) {
    return Response.json({ error: 'Failed to delete image record' }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function PATCH({ params, request, locals }: APIContext): Promise<Response> {
  if (!env?.DB) return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  const user = locals.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const id = parseInt(params.id ?? '', 10);
  if (isNaN(id)) return Response.json({ error: 'Invalid image ID' }, { status: 400 });

  const image = await getImageById(env.DB, id);
  if (!image) return Response.json({ error: 'Image not found' }, { status: 404 });
  if (image.user_id !== user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

  let body: { folder_id?: number | null };
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let folderId: number | null = null;
  if (body.folder_id != null) {
    const fid = Number(body.folder_id);
    if (!Number.isInteger(fid)) return Response.json({ error: 'Invalid folder_id' }, { status: 400 });
    const folder = await getFolderById(env.DB, fid);
    if (!folder || folder.user_id !== user.id) {
      return Response.json({ error: 'Folder not found' }, { status: 404 });
    }
    folderId = fid;
  }

  await moveImagesToFolder(env.DB, user.id, [id], folderId);
  return Response.json({ ok: true, folderId });
}
