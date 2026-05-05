import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { getUserById, setUserPlan } from '../../../lib/db';
import { PLANS, type PlanId } from '../../../lib/plans';

export const prerender = false;

// Rank used to prevent upgrades via this endpoint. Higher rank = better plan.
const RANK: Record<PlanId, number> = { free: 0, pro: 1, master: 2 };

/**
 * POST /api/user/cancel-plan
 * Body: { targetPlan: 'free' | 'pro' }
 *
 * Cancels or downgrades the current plan. Because plans are one-time purchases
 * (no recurring billing), the change takes effect immediately and no refund is
 * issued automatically. Upgrades are NOT allowed through this endpoint — use
 * the /pricing flow instead.
 */
export async function POST({ request, locals }: APIContext): Promise<Response> {
  if (!env?.DB) return Response.json({ error: 'Server misconfiguration' }, { status: 500 });

  const user = locals.user;
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const target = String(body?.targetPlan ?? 'free') as PlanId;
  if (!(target in PLANS)) {
    return Response.json({ error: 'Invalid target plan' }, { status: 400 });
  }

  const dbUser = await getUserById(env.DB, user.id);
  if (!dbUser) return Response.json({ error: 'User not found' }, { status: 404 });

  const current = (dbUser.plan ?? 'free') as PlanId;
  if (current === target) {
    return Response.json({ error: `Already on the ${PLANS[target].name} plan` }, { status: 400 });
  }

  if (RANK[target] >= RANK[current]) {
    return Response.json(
      { error: 'This endpoint only allows downgrades. Use /pricing to upgrade.' },
      { status: 400 },
    );
  }

  await setUserPlan(env.DB, user.id, target);

  return Response.json({
    ok: true,
    previousPlan: current,
    currentPlan: target,
    message:
      target === 'free'
        ? 'Your plan has been cancelled. You are now on the Free plan.'
        : `Your plan has been downgraded to ${PLANS[target].name}.`,
  });
}
