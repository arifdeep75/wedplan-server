import assert from "node:assert/strict";
import test from "node:test";

import {
  PREMIUM_CURRENCY,
  PREMIUM_MONTHS,
  PREMIUM_PRICE_CENTS,
  clientUrl,
  isValidPremiumCheckoutSession,
  type PremiumCheckoutSession,
} from "./stripe.js";

function validSession(
  overrides: Partial<PremiumCheckoutSession> = {}
): PremiumCheckoutSession {
  return {
    mode: "payment",
    payment_status: "paid",
    amount_total: PREMIUM_PRICE_CENTS,
    currency: PREMIUM_CURRENCY,
    client_reference_id: "vendor-1",
    metadata: {
      vendorId: "vendor-1",
      plan: "premium",
      months: String(PREMIUM_MONTHS),
    },
    ...overrides,
  };
}

test("accepts only a fully paid Premium Checkout session for its vendor", () => {
  assert.equal(isValidPremiumCheckoutSession(validSession(), "vendor-1"), true);
  assert.equal(isValidPremiumCheckoutSession(validSession(), "vendor-2"), false);
});

test("rejects unpaid, underpaid, wrong-currency, or mismatched plan sessions", () => {
  const invalidSessions: Partial<PremiumCheckoutSession>[] = [
    { payment_status: "unpaid" },
    { amount_total: PREMIUM_PRICE_CENTS - 1 },
    { currency: "eur" },
    { mode: "subscription" },
    { client_reference_id: "vendor-2" },
    { metadata: { vendorId: "vendor-1", plan: "free", months: "12" } },
    { metadata: { vendorId: "vendor-1", plan: "premium", months: "1" } },
  ];

  for (const invalid of invalidSessions) {
    assert.equal(isValidPremiumCheckoutSession(validSession(invalid)), false);
  }
});

test("production checkout return URLs must use a configured HTTPS origin", () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousClientUrl = process.env.CLIENT_URL;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.CLIENT_URL;
    assert.equal(clientUrl(), null);

    process.env.CLIENT_URL = "http://wedplan.example";
    assert.equal(clientUrl(), null);

    process.env.CLIENT_URL = "https://wedplan.example/path";
    assert.equal(clientUrl(), "https://wedplan.example");
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;

    if (previousClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = previousClientUrl;
  }
});
