import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getPaymentByOrderId,
  setUserPlan,
  updatePaymentStatus,
} from '../../../lib/db';
import { verifyWebhookSignature } from '../../../lib/cashfree';

export const prerender = false;

// Cashfree webhook receiver. Verifies HMAC-SHA256 signature then applies
// plan upgrade on PAYMENT_SUCCESS_WEBHOOK. Idempotent against replays.
export async function POST({ request }: APIContext): Promise<Response> {
  if (!env?.DB) return new Response('Server misconfiguration', { status: 500 });

  const secretKey = (env as any).CASHFREE_SECRET_KEY as string | undefined;
  if (!secretKey) return new Response('Payment gateway not configured', { status: 500 });

  const signature = request.headers.get('x-webhook-signature') ?? '';
  const timestamp = request.headers.get('x-webhook-timestamp') ?? '';
  const rawBody = await request.text();

  const ok = await verifyWebhookSignature(timestamp, rawBody, signature, secretKey);
  if (!ok) return new Response('Invalid signature', { status: 401 });

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const type = String(payload?.type ?? '');
  const order = payload?.data?.order ?? {};
  const payment = payload?.data?.payment ?? {};
  const orderId = String(order?.order_id ?? '');
  const cfPaymentId = payment?.cf_payment_id ? String(payment.cf_payment_id) : null;
  const paymentStatus = String(payment?.payment_status ?? '');

  if (!orderId) return new Response('Missing order_id', { status: 400 });

  const record = await getPaymentByOrderId(env.DB, orderId);
  if (!record) {
    // Unknown order — acknowledge to avoid retry storm
    return new Response('OK', { status: 200 });
  }

  try {
    switch (type) {
      case 'PAYMENT_SUCCESS_WEBHOOK': {
        if (paymentStatus === 'SUCCESS' && record.status !== 'PAID') {
          await updatePaymentStatus(env.DB, orderId, 'PAID', cfPaymentId);
          await setUserPlan(env.DB, record.user_id, record.plan);
        } else if (paymentStatus === 'PENDING' && record.status === 'CREATED') {
          await updatePaymentStatus(env.DB, orderId, 'PENDING', cfPaymentId);
        }
        break;
      }
      case 'PAYMENT_FAILED_WEBHOOK': {
        if (record.status !== 'PAID') {
          await updatePaymentStatus(env.DB, orderId, 'FAILED', cfPaymentId);
        }
        break;
      }
      case 'PAYMENT_USER_DROPPED_WEBHOOK': {
        if (record.status !== 'PAID') {
          await updatePaymentStatus(env.DB, orderId, 'USER_DROPPED', cfPaymentId);
        }
        break;
      }
      default:
        // Ignore other event types
        break;
    }
  } catch (err) {
    console.error('Webhook processing failed', err);
    // Still return 200 so Cashfree doesn't retry for an internal bug;
    // the /verify endpoint will reconcile on user return.
  }

  return new Response('OK', { status: 200 });
}
