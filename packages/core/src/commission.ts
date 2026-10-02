import { type Minor } from './money.js';

export type CommissionType = 'PERCENTAGE' | 'FIXED' | 'PERCENTAGE_PLUS_FIXED';

export interface CommissionRule {
  id: string;
  cityId?: string | null;
  zoneId?: string | null;
  vehicleTypeId?: string | null;
  driverId?: string | null;
  type: CommissionType;
  percent?: number | null;
  fixed?: Minor | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  isActive: boolean;
}

export interface CommissionContext {
  cityId: string;
  zoneId?: string | null;
  vehicleTypeId: string;
  driverId: string;
  at: Date;
}

/** Specificity weight: driver > zone > vehicle type > city > global. Time-limited rules beat open ones. */
function specificity(r: CommissionRule): number {
  return (
    (r.driverId ? 16 : 0) +
    (r.zoneId ? 8 : 0) +
    (r.vehicleTypeId ? 4 : 0) +
    (r.cityId ? 2 : 0) +
    (r.validFrom || r.validTo ? 1 : 0)
  );
}

function matches(r: CommissionRule, c: CommissionContext): boolean {
  if (!r.isActive) return false;
  if (r.driverId && r.driverId !== c.driverId) return false;
  if (r.zoneId && r.zoneId !== c.zoneId) return false;
  if (r.vehicleTypeId && r.vehicleTypeId !== c.vehicleTypeId) return false;
  if (r.cityId && r.cityId !== c.cityId) return false;
  if (r.validFrom && c.at < r.validFrom) return false;
  if (r.validTo && c.at > r.validTo) return false;
  return true;
}

export function resolveCommissionRule(rules: CommissionRule[], ctx: CommissionContext): CommissionRule | undefined {
  return rules.filter((r) => matches(r, ctx)).sort((a, b) => specificity(b) - specificity(a))[0];
}

export interface CommissionResult {
  commission: Minor;
  driverEarning: Minor;
}

/**
 * Commission is taken from the gross fare (before promo discount).
 * Promo discounts are funded by the platform, so the driver is not penalised for them.
 */
export function calculateCommission(grossFare: Minor, rule: CommissionRule | undefined): CommissionResult {
  if (!rule) return { commission: 0, driverEarning: grossFare };
  const pct = rule.type === 'FIXED' ? 0 : (rule.percent ?? 0);
  const fixed = rule.type === 'PERCENTAGE' ? 0 : (rule.fixed ?? 0);
  const commission = Math.min(grossFare, Math.round((grossFare * pct) / 100) + fixed);
  return { commission, driverEarning: grossFare - commission };
}

export interface SettlementResult extends CommissionResult {
  /** Movement on the driver wallet: positive credit, negative debit. */
  driverWalletDelta: Minor;
  /** Platform-funded discount reimbursed to the driver. */
  discountReimbursement: Minor;
}

/**
 * How a completed trip moves money on the driver wallet.
 * - Cash trip: driver already holds `total` in cash, so the wallet is debited the commission
 *   and credited back any platform-funded discount.
 * - Cashless trip: the platform collected `total`; the driver is credited their full earning.
 */
export function settleTrip(
  grossFare: Minor,
  discount: Minor,
  isCash: boolean,
  rule: CommissionRule | undefined,
): SettlementResult {
  const c = calculateCommission(grossFare, rule);
  const driverWalletDelta = isCash ? discount - c.commission : c.driverEarning;
  return { ...c, driverWalletDelta, discountReimbursement: discount };
}
