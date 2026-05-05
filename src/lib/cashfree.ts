// Thin Cashfree Payment Gateway REST client for Cloudflare Workers.
// Uses S2S REST APIs (no Node SDK, which is not Workers-compatible).
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest/overview

export type CashfreeEnv = 'sandbox' | 'production';

export interface CashfreeConfig {
  appId: string;
  secretKey: string;
  env: CashfreeEnv;
  apiVersion?: string;
}

const DEFAULT_API_VERSION = '2025-01-01';

function baseUrl(env: CashfreeEnv): string {
  return env === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

function headers(cfg: CashfreeConfig): Record<string, string> {
  return {
    'x-client-id': cfg.appId,
    'x-client-secret': cfg.secretKey,
    'x-api-version': cfg.apiVersion ?? DEFAULT_API_VERSION,
    'Content-Type': 'application/json',
  };
}

export interface CreateOrderInput {
  orderId: string;
  amount: number;           // rupees, e.g. 70
  currency?: string;        // 'INR' by default
  customer: {
    id: string;
    phone: string;
    email?: string;
    name?: string;
  };
  returnUrl: string;        // must contain {order_id}
  notifyUrl?: string;
  note?: string;
}

export interface CreateOrderResponse {
  cf_order_id: number | string;
  order_id: string;
  order_status: string;
  payment_session_id: string;
  [k: string]: unknown;
}

export async function createOrder(
  cfg: CashfreeConfig,
  input: CreateOrderInput,
): Promise<CreateOrderResponse> {
  const body = {
    order_id: input.orderId,
    order_amount: input.amount,
    order_currency: input.currency ?? 'INR',
    customer_details: {
      customer_id: input.customer.id,
      customer_phone: input.customer.phone,
      ...(input.customer.email ? { customer_email: input.customer.email } : {}),
      ...(input.customer.name ? { customer_name: input.customer.name } : {}),
    },
    order_meta: {
      return_url: input.returnUrl,
      ...(input.notifyUrl ? { notify_url: input.notifyUrl } : {}),
    },
    ...(input.note ? { order_note: input.note } : {}),
  };

  const res = await fetch(`${baseUrl(cfg.env)}/orders`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(body),
  });

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && (json.message || json.error_description)) || `Cashfree createOrder failed (${res.status})`;
    throw new Error(msg);
  }
  return json as CreateOrderResponse;
}

export interface FetchOrderResponse {
  order_id: string;
  cf_order_id?: number | string;
  order_status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED' | 'TERMINATION_REQUESTED' | string;
  order_amount: number;
  order_currency: string;
  [k: string]: unknown;
}

export async function fetchOrder(
  cfg: CashfreeConfig,
  orderId: string,
): Promise<FetchOrderResponse> {
  const res = await fetch(`${baseUrl(cfg.env)}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: headers(cfg),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json && (json.message || json.error_description)) || `Cashfree fetchOrder failed (${res.status})`;
    throw new Error(msg);
  }
  return json as FetchOrderResponse;
}

// Webhook signature verification — HMAC-SHA256(timestamp + rawBody) base64.
// IMPORTANT: pass the RAW request body string, not parsed JSON.
export async function verifyWebhookSignature(
  timestamp: string,
  rawBody: string,
  signature: string,
  secretKey: string,
): Promise<boolean> {
  if (!timestamp || !signature || !secretKey) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(timestamp + rawBody));
  const computed = bufferToBase64(sigBuf);
  // Constant-time compare
  if (computed.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
