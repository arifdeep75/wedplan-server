import { FREE_VENDOR_SERVICE_LIMIT } from "../constants/index.js";

interface SubscriptionFields {
  subscriptionPlan?: string | null;
  subscriptionExpiresAt?: Date | string | null;
}

/**
 * A vendor is premium only while the plan is `premium` AND the paid period has
 * not ended. Expired plans fall back to the free service limit automatically.
 */
export function isPremiumActive(user: SubscriptionFields | null | undefined) {
  if (!user || user.subscriptionPlan !== "premium") return false;

  if (!user.subscriptionExpiresAt) return true;

  const expires = new Date(user.subscriptionExpiresAt).getTime();

  return Number.isFinite(expires) && expires > Date.now();
}

export function getServicesToPause<T extends { _id: unknown }>(
  newestFirst: T[],
  activeLimit = FREE_VENDOR_SERVICE_LIMIT
): T["_id"][] {
  return newestFirst.slice(activeLimit).map((service) => service._id);
}
