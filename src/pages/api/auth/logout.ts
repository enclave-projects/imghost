import type { APIContext } from 'astro';

export const prerender = false;

export async function POST({ cookies }: APIContext): Promise<Response> {
  cookies.delete('session', { path: '/' });
  return Response.json({ ok: true });
}
