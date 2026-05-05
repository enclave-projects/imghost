import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getFolderById,
  renameFolder,
  deleteFolder,
  getImagesByUser,
  deleteImagesByIds,
  moveImagesToFolder,
} from '../../../lib/db';
import { deleteManyFromR2 } from '../../../lib/r2';

export const prerender = false;

// PATCH: rename folder, or move all contents to root before delete (cascade=move|delete)
export async function PATCH({ params, request, locals }: APIContext): Promise<Response> {
  if (!env?.DB) return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  const user = locals.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const id = parseInt(params.id ?? '', 10);
  if (isNaN(id)) return Response.json({ error: 'Invalid folder ID' }, { status: 400 });

  const folder = await getFolderById(env.DB, id);
  if (!folder || folder.user_id !== user.id) {
    return Response.json({ error: 'Folder not found' }, { status: 404 });
  }

  let body: { name?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const name = (body.name ?? '').trim();
  if (!name) return Response.json({ error: 'Folder name required' }, { status: 400 });
  if (name.length > 60) return Response.json({ error: 'Folder name too long' }, { status: 400 });
  if (!/^[\w\-. ()]+$/.test(name)) return Response.json({ error: 'Invalid characters in folder name' }, { status: 400 });

  try {
    const ok = await renameFolder(env.DB, id, user.id, name);
    if (!ok) return Response.json({ error: 'Failed to rename' }, { status: 500 });
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return Response.json({ error: 'A folder with this name already exists' }, { status: 409 });
    return Response.json({ error: 'Failed to rename' }, { status: 500 });
  }
}

// DELETE: ?mode=move (default, move contents to root) | mode=purge (delete all contents from R2+DB)
export async function DELETE({ params, locals, url }: APIContext): Promise<Response> {
  if (!env?.DB || !env?.IMAGES_BUCKET) {
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }
  const user = locals.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const id = parseInt(params.id ?? '', 10);
  if (isNaN(id)) return Response.json({ error: 'Invalid folder ID' }, { status: 400 });

  const folder = await getFolderById(env.DB, id);
  if (!folder || folder.user_id !== user.id) {
    return Response.json({ error: 'Folder not found' }, { status: 404 });
  }

  const mode = url.searchParams.get('mode') === 'purge' ? 'purge' : 'move';

  // Fetch all images in this folder (paginated up to 10k)
  const allImages = await getImagesByUser(env.DB, user.id, 10000, 0, id);

  if (mode === 'purge' && allImages.length > 0) {
    // Delete from R2 first, then DB
    try {
      await deleteManyFromR2(env.IMAGES_BUCKET, allImages.map((i) => i.r2_key));
    } catch {
      return Response.json({ error: 'Failed to delete files from storage' }, { status: 500 });
    }
    await deleteImagesByIds(env.DB, user.id, allImages.map((i) => i.id));
  } else if (mode === 'move' && allImages.length > 0) {
    await moveImagesToFolder(env.DB, user.id, allImages.map((i) => i.id), null);
  }

  const ok = await deleteFolder(env.DB, id, user.id);
  if (!ok) return Response.json({ error: 'Failed to delete folder' }, { status: 500 });

  return Response.json({
    ok: true,
    purgedCount: mode === 'purge' ? allImages.length : 0,
    movedCount: mode === 'move' ? allImages.length : 0,
  });
}
