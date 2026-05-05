import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { createFolder, getFoldersByUser, getFolderImageCounts } from '../../../lib/db';

export const prerender = false;

export async function GET({ locals }: APIContext): Promise<Response> {
  if (!env?.DB) return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  const user = locals.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const [folders, counts] = await Promise.all([
    getFoldersByUser(env.DB, user.id),
    getFolderImageCounts(env.DB, user.id),
  ]);
  return Response.json({
    ok: true,
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      count: counts[f.id] ?? 0,
      createdAt: f.created_at,
    })),
  });
}

export async function POST({ request, locals }: APIContext): Promise<Response> {
  if (!env?.DB) return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  const user = locals.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const name = (body.name ?? '').trim();
  if (!name) return Response.json({ error: 'Folder name required' }, { status: 400 });
  if (name.length > 60) return Response.json({ error: 'Folder name too long (max 60 chars)' }, { status: 400 });
  if (!/^[\w\-. ()]+$/.test(name)) return Response.json({ error: 'Invalid characters in folder name' }, { status: 400 });

  try {
    const folder = await createFolder(env.DB, user.id, name);
    return Response.json({
      ok: true,
      folder: { id: folder.id, name: folder.name, count: 0, createdAt: folder.created_at },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) return Response.json({ error: 'A folder with this name already exists' }, { status: 409 });
    return Response.json({ error: 'Failed to create folder' }, { status: 500 });
  }
}
