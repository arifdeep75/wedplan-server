import Stripe from "stripe";

// Premium is a one-time payment that unlocks 12 months of the premium plan.
export const PREMIUM_MONTHS = 12;
export const PREMIUM_PRICE_CENTS = 4900; // $49.00
export const PREMIUM_CURRENCY = "usd";

export type PremiumCheckoutSession = Pick<
  Stripe.Checkout.Session,
  | "mode"
  | "payment_status"
  | "amount_total"
  | "currency"
  | "metadata"
  | "client_reference_id"
>;

let client: Stripe | null = null;

export function isValidPremiumCheckoutSession(
  session: PremiumCheckoutSession,
  vendorId?: string
): boolean {
  const sessionVendorId = session.metadata?.vendorId;

  return (
    session.mode === "payment" &&
    session.payment_status === "paid" &&
    session.amount_total === PREMIUM_PRICE_CENTS &&
    session.currency === PREMIUM_CURRENCY &&
    session.metadata?.plan === "premium" &&
    session.metadata.months === String(PREMIUM_MONTHS) &&
    Boolean(sessionVendorId) &&
    session.client_reference_id === sessionVendorId &&
    (vendorId === undefined || sessionVendorId === vendorId)
  );
}

/**
 * Returns a Stripe client only when the secret key is configured.
 * Callers must handle `null` instead of pretending a payment happened.
 */
export function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY;

  if (!secret) return null;

  if (!client) {
    client = new Stripe(secret);
  }

  return client;
}

export function clientUrl(): string | null {
  const configured = process.env.CLIENT_URL?.trim();

  if (!configured) {
    return process.env.NODE_ENV === "production"
      ? null
      : "http://localhost:3000";
  }

  try {
    const url = new URL(configured);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}
