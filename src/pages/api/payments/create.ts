import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { PLANS, isPaidPlan, type PlanId } from '../../../lib/plans';
import { createPayment, getUserById } from '../../../lib/db';
import { createOrder, type CashfreeEnv } from '../../../lib/cashfree';

export const prerender = false;

export async function POST({ request, locals }: APIContext): Promise<Response> {
  if (!env?.DB) {
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const user = locals.user;
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appId = (env as any).CASHFREE_APP_ID as string | undefined;
  const secretKey = (env as any).CASHFREE_SECRET_KEY as string | undefined;
  const cfEnv = (((env as any).CASHFREE_ENV as string | undefined) ?? 'sandbox') as CashfreeEnv;
  if (!appId || !secretKey) {
    return Response.json({ error: 'Payment gateway is not configured' }, { status: 500 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const planId = String(body?.plan ?? '') as PlanId;
  if (!isPaidPlan(planId)) {
    return Response.json({ error: 'Invalid plan' }, { status: 400 });
  }
  const plan = PLANS[planId];

  // Customer phone is required by Cashfree. Accept from request or fall back to a placeholder.
  // NOTE: users currently have no phone field, so we ask the frontend to collect it.
  const phone = String(body?.phone ?? '').trim();
  if (!/^[0-9]{10}$/.test(phone)) {
    return Response.json({ error: 'A valid 10-digit phone number is required' }, { status: 400 });
  }

  const dbUser = await getUserById(env.DB, user.id);
  if (!dbUser) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const orderId = `imghost_${user.id}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const origin = new URL(request.url).origin;

  try {
    const cfOrder = await createOrder(
      { appId, secretKey, env: cfEnv },
      {
        orderId,
        amount: plan.priceInr,
        currency: 'INR',
        customer: {
          id: `user_${user.id}`,
          phone,
          email: dbUser.email,
        },
        returnUrl: `${origin}/payment/return?order_id={order_id}`,
        notifyUrl: `${origin}/api/payments/webhook`,
        note: `Imghost ${plan.name} plan upgrade`,
      },
    );

    await createPayment(env.DB, {
      userId: user.id,
      orderId,
      plan: planId,
      amount: plan.priceInr,
      currency: 'INR',
      cfOrderId: String(cfOrder.cf_order_id ?? ''),
      paymentSessionId: cfOrder.payment_session_id,
    });

    return Response.json({
      ok: true,
      orderId,
      paymentSessionId: cfOrder.payment_session_id,
      environment: cfEnv,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Failed to create payment order: ${msg}` }, { status: 502 });
  }
}
