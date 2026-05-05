import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { getImagesByUser, countRecentUploads } from '../../lib/db';

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

  const [images, uploadsUsed] = await Promise.all([
    getImagesByUser(env.DB, user.id, limit, offset),
    offset === 0 ? countRecentUploads(env.DB, user.id) : Promise.resolve(0),
  ]);

  const origin = new URL(request.url).origin;

  return Response.json({
    ok: true,
    uploadsUsed,
    uploadsLimit: 10,
    images: images.map((img) => ({
      id: img.id,
      filename: img.filename,
      size: img.size,
      contentType: img.content_type,
      url: `${origin}/images/${img.r2_key}`,
      createdAt: img.created_at,
    })),
  });
}
