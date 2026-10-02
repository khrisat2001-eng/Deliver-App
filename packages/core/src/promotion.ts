import { type Minor } from './money.js';

export interface Promotion {
  type: 'PERCENTAGE' | 'FIXED' | 'FIRST_TRIP';
  percent?: number;
  amount?: Minor;
  maxDiscount?: Minor;
  minFare?: Minor;
  cityIds: string[];
  vehicleTypeIds: string[];
  startsAt: Date;
  endsAt: Date;
  totalLimit?: number;
  perUserLimit: number;
  usedCount: number;
  isActive: boolean;
}

export interface PromoContext {
  fare: Minor;
  cityId: string;
  vehicleTypeId: string;
  at: Date;
  userUses: number;
  userCompletedTrips: number;
}

export type PromoResult = { ok: true; discount: Minor } | { ok: false; reason: string };

export function evaluatePromotion(p: Promotion, c: PromoContext): PromoResult {
  if (!p.isActive) return { ok: false, reason: 'inactive' };
  if (c.at < p.startsAt || c.at > p.endsAt) return { ok: false, reason: 'expired' };
  if (p.totalLimit != null && p.usedCount >= p.totalLimit) return { ok: false, reason: 'limit_reached' };
  if (c.userUses >= p.perUserLimit) return { ok: false, reason: 'user_limit_reached' };
  if (p.cityIds.length && !p.cityIds.includes(c.cityId)) return { ok: false, reason: 'city_not_eligible' };
  if (p.vehicleTypeIds.length && !p.vehicleTypeIds.includes(c.vehicleTypeId)) return { ok: false, reason: 'vehicle_not_eligible' };
  if (p.minFare != null && c.fare < p.minFare) return { ok: false, reason: 'below_min_fare' };
  if (p.type === 'FIRST_TRIP' && c.userCompletedTrips > 0) return { ok: false, reason: 'not_first_trip' };

  const raw = p.percent != null ? Math.round((c.fare * p.percent) / 100) : (p.amount ?? 0);
  const capped = p.maxDiscount != null ? Math.min(raw, p.maxDiscount) : raw;
  return { ok: true, discount: Math.min(capped, c.fare) };
}
