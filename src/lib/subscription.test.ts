import assert from "node:assert/strict";
import test from "node:test";

import {
  getServicesToPause,
  isPremiumActive,
} from "./subscription.js";

test("expired premium plans no longer have premium entitlements", () => {
  assert.equal(
    isPremiumActive({
      subscriptionPlan: "premium",
      subscriptionExpiresAt: new Date(Date.now() - 1_000),
    }),
    false
  );
});

test("current premium plans retain premium entitlements", () => {
  assert.equal(
    isPremiumActive({
      subscriptionPlan: "premium",
      subscriptionExpiresAt: new Date(Date.now() + 60_000),
    }),
    true
  );
});

test("the newest three services remain active after premium expiry", () => {
  const toPause = getServicesToPause(
    [{ _id: "newest" }, { _id: "middle" }, { _id: "oldest-active" }, { _id: "oldest" }],
    3
  );

  assert.deepEqual(toPause, ["oldest"]);
});
