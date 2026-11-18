import { Router } from "express";

import { requireAuth, requireVendor } from "../../middleware/auth.middleware.js";
import {
  activateDemoPremium,
  confirmCheckout,
  createCheckoutSession,
  getSubscriptionStatus,
  listMyTransactions,
} from "./payment.controller.js";

const router = Router();

// Vendor: current plan, price and recent transactions
router.get("/status", requireAuth, requireVendor, getSubscriptionStatus);

// Vendor: start a Stripe Checkout session (or demo mode)
router.post("/checkout", requireAuth, requireVendor, createCheckoutSession);

// Vendor: confirm the session Stripe redirects back with
router.post("/confirm", requireAuth, requireVendor, confirmCheckout);

// Vendor: explicit demo activation, only when PAYMENTS_DEMO=true
router.post("/demo-activate", requireAuth, requireVendor, activateDemoPremium);

// Vendor: own payment history
router.get("/mine", requireAuth, requireVendor, listMyTransactions);

export default router;
