import Stripe from "stripe";

// Premium is a one-time payment that unlocks 12 months of the premium plan.
export const PREMIUM_MONTHS = 12;
export const PREMIUM_PRICE_CENTS = 4900; // $49.00
export const PREMIUM_CURRENCY = "usd";

let client: Stripe | null = null;

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

/**
 * Explicit demo mode for environments without Stripe keys. It is never
 * enabled silently: `PAYMENTS_DEMO=true` must be set, and every recorded
 * transaction is labelled `provider: "demo"` so nobody mistakes it for a
 * real payment.
 */
export function paymentsDemoEnabled(): boolean {
  return process.env.PAYMENTS_DEMO === "true";
}

export function clientUrl(): string {
  return process.env.CLIENT_URL || "http://localhost:3000";
}
