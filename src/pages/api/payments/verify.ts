import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getPaymentByOrderId,
  setUserPlan,
  updatePaymentStatus,
} from '../../../lib/db';
import { fetchOrder, type CashfreeEnv } from '../../../lib/cashfree';

export const prerender = false;

// Called from /payment/return after Cashfree redirects the user back.
// Authoritatively checks order status and upgrades the user's plan if PAID.
export async function GET({ url, locals }: APIContext): Promise<Response> {
  if (!env?.DB) {
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }
  const user = locals.user;
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orderId = url.searchParams.get('order_id');
  if (!orderId) {
    return Response.json({ error: 'Missing order_id' }, { status: 400 });
  }

  const payment = await getPaymentByOrderId(env.DB, orderId);
  if (!payment || payment.user_id !== user.id) {
    return Response.json({ error: 'Order not found' }, { status: 404 });
  }

  const appId = (env as any).CASHFREE_APP_ID as string | undefined;
  const secretKey = (env as any).CASHFREE_SECRET_KEY as string | undefined;
  const cfEnv = (((env as any).CASHFREE_ENV as string | undefined) ?? 'sandbox') as CashfreeEnv;
  if (!appId || !secretKey) {
    return Response.json({ error: 'Payment gateway is not configured' }, { status: 500 });
  }

  let cfOrder;
  try {
    cfOrder = await fetchOrder({ appId, secretKey, env: cfEnv }, orderId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Failed to verify order: ${msg}` }, { status: 502 });
  }

  const status = String(cfOrder.order_status);

  if (status === 'PAID' && payment.status !== 'PAID') {
    await updatePaymentStatus(env.DB, orderId, 'PAID');
    await setUserPlan(env.DB, user.id, payment.plan);
  } else if (status === 'EXPIRED' && payment.status !== 'EXPIRED') {
    await updatePaymentStatus(env.DB, orderId, 'EXPIRED');
  } else if (status !== payment.status && status !== 'ACTIVE') {
    await updatePaymentStatus(env.DB, orderId, status);
  }

  return Response.json({
    ok: true,
    orderId,
    status,
    plan: payment.plan,
    upgraded: status === 'PAID',
  });
}
