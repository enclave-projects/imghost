import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { hashPassword, createSessionToken } from '../../../lib/auth';
import { getUserByEmail, createUser } from '../../../lib/db';

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

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: 'Invalid email address' }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const existing = await getUserByEmail(env.DB, email);
  if (existing) {
    return Response.json({ error: 'Email already registered' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(env.DB, email, passwordHash);

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
