import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyPassword, createSessionToken } from '../../../lib/auth';
import { getUserByEmail } from '../../../lib/db';

export const prerender = false;

export async function POST({ request, cookies, url }: APIContext): Promise<Response> {
  const isSecure = url.protocol === 'https:';
  if (!env?.DB || !env?.JWT_SECRET) return Response.json({ error: 'Server misconfiguration' }, { status: 500 });

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  if (!email || !password) {
    return Response.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const user = await getUserByEmail(env.DB, email);
  if (!user) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createSessionToken({ sub: user.id, email: user.email }, env.JWT_SECRET);

  cookies.set('session', token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return Response.json({ ok: true, user: { id: user.id, email: user.email } });
}
