// Plan definitions, per-plan limits, and pricing.

export type PlanId = 'free' | 'pro' | 'master';

export interface Plan {
  id: PlanId;
  name: string;
  priceInr: number;          // whole rupees; 0 for free
  storageBytes: number;      // combined image + video storage cap
  maxVideoBytes: number;     // per-file video cap
  maxImageBytes: number;     // per-file image cap
  uploadsPerWindow: number;    // combined rate limit count
  uploadWindowMinutes: number; // rolling window in minutes
  features: string[];
  prioritySupport: boolean;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceInr: 0,
    storageBytes: 500 * MB,
    maxImageBytes: 10 * MB,
    maxVideoBytes: 100 * MB,
    uploadsPerWindow: 10,
    uploadWindowMinutes: 60,
    features: [
      '500 MB combined storage',
      '10 MB per image · 100 MB per video',
      '10 uploads per hour',
      'Community support',
    ],
    prioritySupport: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceInr: 70,
    storageBytes: 5 * GB,
    maxImageBytes: 1 * GB,
    maxVideoBytes: 1 * GB,
    uploadsPerWindow: 30,
    uploadWindowMinutes: 30,
    features: [
      '5 GB combined storage',
      'Uploads up to 1 GB per file (images & videos)',
      '30 uploads per 30 minutes',
      'Priority support 24/7',
    ],
    prioritySupport: true,
  },
  master: {
    id: 'master',
    name: 'Master',
    priceInr: 150,
    storageBytes: 25 * GB,
    maxImageBytes: 5 * GB,
    maxVideoBytes: 5 * GB,
    uploadsPerWindow: 60,
    uploadWindowMinutes: 5,
    features: [
      '25 GB combined storage',
      'Uploads up to 5 GB per file (images & videos)',
      '60 uploads per 5 minutes',
      'Priority support 24/7',
    ],
    prioritySupport: true,
  },
};

export const PAID_PLANS: PlanId[] = ['pro', 'master'];

export function getPlan(id: string | null | undefined): Plan {
  if (id && (id in PLANS)) return PLANS[id as PlanId];
  return PLANS.free;
}

export function isPaidPlan(id: string | null | undefined): boolean {
  return id === 'pro' || id === 'master';
}

export const STORAGE_WARN_RATIO = 0.8;
