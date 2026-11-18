import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";

import { getDB } from "../../config/db.js";
import { COLLECTIONS } from "../../config/collections.js";
import { FREE_VENDOR_SERVICE_LIMIT } from "../../constants/index.js";
import {
  PREMIUM_CURRENCY,
  PREMIUM_MONTHS,
  PREMIUM_PRICE_CENTS,
  clientUrl,
  getStripe,
  paymentsDemoEnabled,
} from "../../lib/stripe.js";
import { isPremiumActive } from "../../lib/subscription.js";
import type { AuthUser } from "../../middleware/auth.middleware.js";

interface TransactionDocument {
  _id: unknown;
  vendorId: string;
  vendorName?: string;
  vendorEmail?: string;
  type?: string;
  plan?: string;
  amount?: number;
  currency?: string;
  status?: string;
  provider?: string;
  stripeSessionId?: string;
  createdAt?: Date;
  paidAt?: Date;
}

interface UserDocument {
  _id: unknown;
  name?: string;
  email?: string;
  subscriptionPlan?: string;
  subscriptionExpiresAt?: Date | null;
}

function users() {
  return getDB().collection("user");
}

function transactions() {
  return getDB().collection(COLLECTIONS.TRANSACTIONS);
}

function toObjectId(id: string): ObjectId | null {
  try {
    return ObjectId.isValid(id) && /^[a-f\d]{24}$/i.test(id)
      ? new ObjectId(id)
      : null;
  } catch {
    return null;
  }
}

function currentUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

function toPublicTransaction(doc: TransactionDocument) {
  return {
    id: String(doc._id),
    plan: doc.plan ?? "premium",
    amount: doc.amount ?? 0,
    currency: doc.currency ?? PREMIUM_CURRENCY,
    status: doc.status ?? "pending",
    provider: doc.provider ?? "stripe",
    createdAt: doc.createdAt ?? null,
    paidAt: doc.paidAt ?? null,
  };
}

async function findUser(userId: string) {
  const id = toObjectId(userId);

  if (!id) return null;

  return (await users().findOne({ _id: id })) as unknown as UserDocument | null;
}

/**
 * Marks the vendor as premium for another 12 months and records the payment.
 * Called by both the Stripe webhook and the explicit confirm endpoint, so it
 * is idempotent: renewing stacks on top of an unexpired period, and replaying
 * the same session id never creates duplicate transactions.
 */
async function activatePremium(
  userId: string,
  payment: {
    sessionId: string;
    amount: number;
    currency: string;
    provider: "stripe" | "demo";
  }
) {
  const id = toObjectId(userId);

  if (!id) {
    throw new Error("Invalid vendor id");
  }

  const user = await findUser(userId);

  if (!user) {
    throw new Error("Vendor account not found");
  }

  const now = new Date();
  const currentExpiry = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;
  const base =
    currentExpiry && currentExpiry.getTime() > now.getTime()
      ? currentExpiry
      : now;
  const expiresAt = new Date(base);
  expiresAt.setMonth(expiresAt.getMonth() + PREMIUM_MONTHS);

  await users().updateOne(
    { _id: id },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: expiresAt,
        updatedAt: now,
      },
    }
  );

  await transactions().updateOne(
    { stripeSessionId: payment.sessionId },
    {
      $set: {
        vendorId: userId,
        vendorName: user.name ?? "",
        vendorEmail: user.email ?? "",
        type: "subscription",
        plan: "premium",
        amount: payment.amount,
        currency: payment.currency,
        status: "paid",
        provider: payment.provider,
        paidAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        stripeSessionId: payment.sessionId,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return { plan: "premium" as const, expiresAt };
}

async function subscriptionSnapshot(user: AuthUser) {
  const doc = await findUser(user.id);
  const premium = isPremiumActive(doc);
  const [history, paidCount] = await Promise.all([
    transactions()
      .find({ vendorId: user.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray() as unknown as Promise<TransactionDocument[]>,
    transactions().countDocuments({ vendorId: user.id, status: "paid" }),
  ]);

  return {
    plan: premium ? "premium" : "free",
    expiresAt: premium ? (doc?.subscriptionExpiresAt ?? null) : null,
    stripeConfigured: Boolean(getStripe()),
    demoEnabled: paymentsDemoEnabled(),
    price: {
      amount: PREMIUM_PRICE_CENTS,
      currency: PREMIUM_CURRENCY,
      months: PREMIUM_MONTHS,
    },
    freeServiceLimit: FREE_VENDOR_SERVICE_LIMIT,
    paidTransactions: paidCount,
    transactions: history.map(toPublicTransaction),
  };
}

/* ------------------------------------------------------------------ */
/* Vendor endpoints                                                    */
/* ------------------------------------------------------------------ */

// Current plan, expiry, upgrade options and recent transactions.
export async function getSubscriptionStatus(_req: Request, res: Response) {
  try {
    const user = currentUser(res);
    const data = await subscriptionSnapshot(user);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Subscription status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load your subscription",
    });
  }
}

// Starts a Stripe Checkout session. Without Stripe keys this fails honestly
// (503) unless explicit demo mode is enabled.
export async function createCheckoutSession(_req: Request, res: Response) {
  try {
    const user = currentUser(res);
    const stripe = getStripe();

    if (stripe) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: PREMIUM_CURRENCY,
              unit_amount: PREMIUM_PRICE_CENTS,
              product_data: {
                name: `WedPlan Premium — ${PREMIUM_MONTHS} months`,
                description:
                  "Unlimited service listings and a premium vendor badge.",
              },
            },
          },
        ],
        client_reference_id: user.id,
        metadata: {
          vendorId: user.id,
          plan: "premium",
          months: String(PREMIUM_MONTHS),
        },
        success_url: `${clientUrl()}/dashboard/vendor?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl()}/dashboard/vendor?payment=cancelled`,
      });

      if (!session.url) {
        return res.status(502).json({
          success: false,
          message: "Stripe did not return a checkout URL",
        });
      }

      const now = new Date();

      await transactions().insertOne({
        vendorId: user.id,
        vendorName: user.name ?? "",
        vendorEmail: user.email ?? "",
        type: "subscription",
        plan: "premium",
        amount: PREMIUM_PRICE_CENTS,
        currency: PREMIUM_CURRENCY,
        status: "pending",
        provider: "stripe",
        stripeSessionId: session.id,
        createdAt: now,
        updatedAt: now,
      });

      return res.status(200).json({
        success: true,
        data: { url: session.url, sessionId: session.id },
      });
    }

    if (paymentsDemoEnabled()) {
      return res.status(200).json({ success: true, data: { demo: true } });
    }

    return res.status(503).json({
      success: false,
      message:
        "Payments are not configured yet. Please try again later or contact support.",
    });
  } catch (error) {
    console.error("Create checkout error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to start checkout",
    });
  }
}

// Called when Stripe redirects back with `session_id`. Verifies ownership and
// payment state before granting premium, so a crafted URL cannot unlock it.
export async function confirmCheckout(req: Request, res: Response) {
  try {
    const user = currentUser(res);
    const stripe = getStripe();

    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: "Payments are not configured yet.",
      });
    }

    const sessionId = String(req.body?.sessionId ?? "").trim();

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Checkout session is required",
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.metadata?.vendorId !== user.id) {
      return res.status(403).json({
        success: false,
        message: "This checkout does not belong to your account",
      });
    }

    if (session.payment_status !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Payment has not been completed yet",
      });
    }

    await activatePremium(user.id, {
      sessionId: session.id,
      amount: session.amount_total ?? PREMIUM_PRICE_CENTS,
      currency: session.currency ?? PREMIUM_CURRENCY,
      provider: "stripe",
    });

    const data = await subscriptionSnapshot(user);

    return res.status(200).json({
      success: true,
      message: "Premium activated",
      data,
    });
  } catch (error) {
    console.error("Confirm checkout error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to confirm your payment",
    });
  }
}

// Explicit demo activation (PAYMENTS_DEMO=true). Recorded as provider "demo"
// so it can never be confused with real revenue.
export async function activateDemoPremium(_req: Request, res: Response) {
  try {
    if (!paymentsDemoEnabled()) {
      return res.status(403).json({
        success: false,
        message: "Demo payments are disabled",
      });
    }

    const user = currentUser(res);

    await activatePremium(user.id, {
      sessionId: `demo_${Date.now()}_${randomUUID()}`,
      amount: 0,
      currency: PREMIUM_CURRENCY,
      provider: "demo",
    });

    const data = await subscriptionSnapshot(user);

    return res.status(200).json({
      success: true,
      message: "Demo premium activated — no real payment was taken.",
      data,
    });
  } catch (error) {
    console.error("Demo activation error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to activate the demo plan",
    });
  }
}

export async function listMyTransactions(_req: Request, res: Response) {
  try {
    const user = currentUser(res);

    const found = (await transactions()
      .find({ vendorId: user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray()) as unknown as TransactionDocument[];

    return res.status(200).json({
      success: true,
      data: found.map(toPublicTransaction),
    });
  } catch (error) {
    console.error("List transactions error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load transactions",
    });
  }
}

/* ------------------------------------------------------------------ */
/* Stripe webhook                                                      */
/* ------------------------------------------------------------------ */

// Mounted with express.raw() before express.json(); the signature is always
// verified before anything is written to the database.
export async function stripeWebhook(req: Request, res: Response) {
  try {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripe || !secret) {
      return res.status(503).json({
        success: false,
        message: "Webhook is not configured",
      });
    }

    const signature = req.headers["stripe-signature"];

    if (typeof signature !== "string") {
      return res.status(400).json({
        success: false,
        message: "Missing Stripe signature",
      });
    }

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, signature, secret);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Invalid Stripe signature",
      });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (
        session.payment_status === "paid" &&
        typeof session.metadata?.vendorId === "string"
      ) {
        await activatePremium(session.metadata.vendorId, {
          sessionId: session.id,
          amount: session.amount_total ?? 0,
          currency: session.currency ?? PREMIUM_CURRENCY,
          provider: "stripe",
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);

    return res.status(500).json({
      success: false,
      message: "Webhook handling failed",
    });
  }
}
