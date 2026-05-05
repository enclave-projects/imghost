import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { verifySessionToken } from './lib/auth';

const PUBLIC_PATHS = new Set(['/', '/login', '/signup', '/pricing']);
const PUBLIC_PREFIXES = ['/api/auth/', '/images/', '/api/payments/webhook'];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { url, locals, cookies, redirect } = ctx;
  const path = url.pathname;

  if (env?.JWT_SECRET) {
    const token = cookies.get('session')?.value;
    if (token) {
      const payload = await verifySessionToken(token, env.JWT_SECRET);
      if (payload) {
        locals.user = { id: payload.sub, email: payload.email };
      }
    }
  }

  const isPublic =
    PUBLIC_PATHS.has(path) ||
    PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  if (!isPublic && !locals.user) {
    // API requests expect JSON, not a redirect
    if (path.startsWith('/api/')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return redirect('/login');
  }

  if ((path === '/login' || path === '/signup') && locals.user) {
    return redirect('/dashboard');
  }

  return next();
});
