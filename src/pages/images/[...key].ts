import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { getFromR2 } from '../../lib/r2';

export const prerender = false;

export async function GET({ params }: APIContext): Promise<Response> {
  if (!env?.IMAGES_BUCKET) {
    return new Response('Server misconfiguration', { status: 500 });
  }

  const key = params.key;
  if (!key) {
    return new Response('Not found', { status: 404 });
  }

  const object = await getFromR2(env.IMAGES_BUCKET, key);
  if (!object) {
    return new Response('Image not found', { status: 404 });
  }

  const headers = new Headers();
  if (object.httpMetadata?.contentType) {
    headers.set('Content-Type', object.httpMetadata.contentType);
  }
  headers.set(
    'Cache-Control',
    object.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
  );
  headers.set('Content-Disposition', 'inline');
  headers.set('ETag', object.httpEtag);
  headers.set('Last-Modified', object.uploaded.toUTCString());

  return new Response(object.body, { headers });
}
