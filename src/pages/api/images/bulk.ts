import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getImagesByIds,
  deleteImagesByIds,
  moveImagesToFolder,
  getFolderById,
} from '../../../lib/db';
import { deleteManyFromR2 } from '../../../lib/r2';

export const prerender = false;

interface BulkBody {
  action: 'delete' | 'move';
  ids: number[];
  folder_id?: number | null; // for move; null/omitted = root
}

export async function POST({ request, locals }: APIContext): Promise<Response> {
  if (!env?.DB || !env?.IMAGES_BUCKET) {
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }
  const user = locals.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: BulkBody;
  try { body = await request.json() as BulkBody; }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const ids = Array.isArray(body.ids)
    ? body.ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : [];

  if (ids.length === 0) return Response.json({ error: 'No image IDs provided' }, { status: 400 });
  if (ids.length > 1000) return Response.json({ error: 'Too many items (max 1000 per batch)' }, { status: 400 });

  // Verify ownership
  const owned = await getImagesByIds(env.DB, user.id, ids);
  if (owned.length === 0) return Response.json({ error: 'No matching images' }, { status: 404 });
  const ownedIds = owned.map((i) => i.id);

  if (body.action === 'delete') {
    try {
      await deleteManyFromR2(env.IMAGES_BUCKET, owned.map((i) => i.r2_key));
    } catch {
      return Response.json({ error: 'Failed to delete files from storage' }, { status: 500 });
    }
    const deleted = await deleteImagesByIds(env.DB, user.id, ownedIds);
    return Response.json({ ok: true, deleted });
  }

  if (body.action === 'move') {
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
    const moved = await moveImagesToFolder(env.DB, user.id, ownedIds, folderId);
    return Response.json({ ok: true, moved, folderId });
  }

  return Response.json({ error: 'Unsupported action' }, { status: 400 });
}
