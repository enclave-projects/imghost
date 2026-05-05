import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getImagesByUser,
  countRecentUploads,
  getUserStorageUsed,
  getUserById,
  getFoldersByUser,
  getFolderImageCounts,
} from '../../lib/db';
import { getPlan } from '../../lib/plans';

export const prerender = false;

export async function GET({ request, locals, url }: APIContext): Promise<Response> {
  if (!env?.DB) {
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const user = locals.user;
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0'), 0);

  // folder_id query: 'all' (default) | 'root' | numeric id
  const folderParam = url.searchParams.get('folder_id');
  let folderFilter: number | null | 'all' = 'all';
  if (folderParam === 'root' || folderParam === 'null') folderFilter = null;
  else if (folderParam && !isNaN(parseInt(folderParam, 10))) folderFilter = parseInt(folderParam, 10);

  const dbUser = offset === 0 ? await getUserById(env.DB, user.id) : null;
  const plan = getPlan(dbUser?.plan);

  const [images, uploadsUsed, storageUsed, folders, folderCounts] = await Promise.all([
    getImagesByUser(env.DB, user.id, limit, offset, folderFilter),
    offset === 0 ? countRecentUploads(env.DB, user.id, plan.uploadWindowMinutes) : Promise.resolve(0),
    offset === 0 ? getUserStorageUsed(env.DB, user.id) : Promise.resolve(0),
    offset === 0 ? getFoldersByUser(env.DB, user.id) : Promise.resolve([]),
    offset === 0 ? getFolderImageCounts(env.DB, user.id) : Promise.resolve({} as Record<number, number>),
  ]);
  const origin = new URL(request.url).origin;

  return Response.json({
    ok: true,
    plan: {
      id: plan.id,
      name: plan.name,
      maxImageBytes: plan.maxImageBytes,
      maxVideoBytes: plan.maxVideoBytes,
    },
    uploadsUsed,
    uploadsLimit: plan.uploadsPerWindow,
    uploadsWindowMinutes: plan.uploadWindowMinutes,
    storageUsed,
    storageLimit: plan.storageBytes,
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      count: folderCounts[f.id] ?? 0,
      createdAt: f.created_at,
    })),
    images: images.map((img) => ({
      id: img.id,
      filename: img.filename,
      size: img.size,
      contentType: img.content_type,
      mediaType: img.media_type ?? 'image',
      url: `${origin}/images/${img.r2_key}`,
      createdAt: img.created_at,
      folderId: img.folder_id ?? null,
    })),
  });
}
