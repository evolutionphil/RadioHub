import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it, type TestContext } from "node:test";
import pg from "pg";

// A dedicated test URL opts in; all fixtures and migrations live in a random
// isolated schema. Production DATABASE_URL is never an implicit fallback.
const connectionString = process.env.PG_TEST_DATABASE_URL;

describe("PostgreSQL billing transactions", { skip: !connectionString }, async () => {
  if (!connectionString) return;
  const schema = `billing_test_${process.pid}_${randomBytes(6).toString("hex")}`;
  const ssl = process.env.PG_TEST_SSL === "require" ? { rejectUnauthorized: true } : false;
  const admin = new pg.Pool({ connectionString, ssl, max: 1 });
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.POSTGRES_SSL = ssl ? "require" : "disable";
  process.env.USER_STORE = "postgres";
  process.env.BILLING_STORE = "postgres";
  process.env.STRIPE_SECRET_KEY = "sk_test_offline_integration";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_offline_integration";
  process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_offline_integration";
  process.env.PADDLE_WEBHOOK_SECRET = "offline_paddle_integration";
  process.env.PADDLE_PRICE_MONTHLY = "pri_offline_monthly";
  process.env.GOOGLE_PLAY_RTDN_SECRET = "offline_google_integration";
  delete process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE;
  const { getPostgresPool, closePostgres } = await import("../src/postgres-runtime");
  const { pgApplySubscriptionEvent, pgGetSubscription, pgUpsertSubscription } = await import("../src/data/postgres-billing-store");
  const pool = getPostgresPool();
  let schemaCreated = false;
  before(async () => {
    assert.match(schema, /^billing_test_\d+_[a-f0-9]{12}$/);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrations = path.resolve(import.meta.dirname, "../../../lib/db/migrations");
    for (const file of (await readdir(migrations)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
      await pool.query(await readFile(path.join(migrations, file), "utf8"));
    }
  });
  after(async () => {
    await closePostgres();
    try {
      if (schemaCreated) {
        assert.match(schema, /^billing_test_\d+_[a-f0-9]{12}$/);
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await admin.end(); }
  });

  async function webhookServer(t: TestContext) {
    const { default: express } = await import("express");
    const { default: Stripe } = await import("stripe");
    const { registerStripeSubscriptionRoutes } = await import("../src/routes/stripe-subscription-routes");
    const { registerGooglePlayRtdnRoutes } = await import("../src/routes/iap-google-play-rtdn");
    const app = express();
    app.use("/api/webhooks/google-play-rtdn", express.raw({ type: "*/*" }));
    app.use(express.json({ verify: (req, _res, buffer) => { (req as any).rawBody = buffer.toString("utf8"); } }));
    const next = (_req: unknown, _res: unknown, proceed: () => void) => proceed();
    registerStripeSubscriptionRoutes(app, { requireAuth: next, requireAdmin: next });
    registerGooglePlayRtdnRoutes(app);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const address = server.address() as { port: number };
    const stripe = new Stripe("sk_test_offline_integration");
    return {
      post: async (path: string, body: unknown, headers: Record<string, string> = {}) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
          method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers },
          signal: AbortSignal.timeout(10_000),
        });
        return { status: response.status, body: await response.json() as Record<string, any> };
      },
      stripeHeader: (body: unknown) => stripe.webhooks.generateTestHeaderString({
        payload: JSON.stringify(body), secret: "whsec_offline_integration",
      }),
      paddleHeader: (body: unknown) => {
        const timestamp = Math.floor(Date.now() / 1000);
        return `ts=${timestamp};h1=${createHmac("sha256", "offline_paddle_integration").update(`${timestamp}:${JSON.stringify(body)}`).digest("hex")}`;
      },
    };
  }

  async function user(t: TestContext): Promise<string> {
    const id = `test-billing-${randomUUID()}`;
    await pool.query(
      "INSERT INTO users(id,username,email,full_name) VALUES($1,$1,$2,'Billing transaction test')",
      [id, `${id}@example.invalid`],
    );
    t.after(async () => {
      await pool.query("DELETE FROM payment_events WHERE user_id=$1", [id]);
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    });
    return id;
  }

  function event(userId: string, provider: "apple" | "google" = "apple") {
    return {
      provider, providerEventId: `test-billing-${randomUUID()}`, userId,
      eventType: "test", status: "success", payload: {},
    };
  }

  it("preserves independent concurrent patches, including the first subscription insert", async (t) => {
    const id = await user(t);
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      pgUpsertSubscription(id, { [`independentField${index}`]: index }),
    ));
    const subscription = await pgGetSubscription(id);
    for (let index = 0; index < 20; index += 1) assert.equal(subscription?.[`independentField${index}`], index);
  });

  it("applies one concurrent delivery and never replays its upgrade after a later revoke", async (t) => {
    const id = await user(t);
    const delivery = event(id);
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      pgApplySubscriptionEvent(id, { plan: "premium_monthly", isActive: true }, delivery),
    ));
    assert.equal(results.filter((result) => result === "applied").length, 1);
    assert.equal(results.filter((result) => result === "duplicate").length, 9);
    await pgUpsertSubscription(id, { plan: "none", isActive: false });
    assert.equal(await pgApplySubscriptionEvent(id, { plan: "premium_monthly", isActive: true }, delivery), "duplicate");
    assert.equal((await pgGetSubscription(id))?.isActive, false);
    const receipts = await pool.query("SELECT count(*)::int count FROM payment_events WHERE user_id=$1", [id]);
    assert.equal(receipts.rows[0].count, 1);
  });

  it("rolls back the receipt on database failure and allows a complete retry", async (t) => {
    const id = await user(t);
    const delivery = event(id);
    await pgUpsertSubscription(id, { plan: "none", isActive: false });
    // subscriptions.plan is NOT NULL: failure occurs after receipt insertion.
    await assert.rejects(pgApplySubscriptionEvent(id, { plan: null }, delivery), /null value/i);
    assert.equal((await pgGetSubscription(id))?.plan, "none");
    const receipts = await pool.query("SELECT count(*)::int count FROM payment_events WHERE user_id=$1", [id]);
    assert.equal(receipts.rows[0].count, 0);
    assert.equal(await pgApplySubscriptionEvent(id, { plan: "premium_monthly", isActive: true }, delivery), "applied");
    assert.equal((await pgGetSubscription(id))?.isActive, true);
  });

  it("checks stale upgrades against the state committed by a concurrent revocation", async (t) => {
    const id = await user(t);
    const revoke = pgApplySubscriptionEvent(id, { plan: "none", isActive: false }, event(id), {
      order: { field: "lastSignedDate", timestamp: 3000, isDowngrade: true },
    });
    const upgrade = pgApplySubscriptionEvent(id, { plan: "premium_monthly", isActive: true }, event(id), {
      order: { field: "lastSignedDate", timestamp: 2000, isDowngrade: false },
    });
    const [revoked, upgraded] = await Promise.all([revoke, upgrade]);
    assert.equal(revoked, "applied");
    assert.ok(["applied", "stale"].includes(upgraded));
    assert.equal(await pgApplySubscriptionEvent(id, { isActive: true }, event(id), {
      order: { field: "lastSignedDate", timestamp: 2000, isDowngrade: false },
    }), "stale");
    assert.equal((await pgGetSubscription(id))?.isActive, false);
  });

  it("never rewinds Google's provider timestamp when applying a late downgrade", async (t) => {
    const id = await user(t);
    await pgApplySubscriptionEvent(id, { isActive: true }, event(id, "google"), {
      order: { field: "lastGoogleEventTime", timestamp: 5000, isDowngrade: false },
    });
    assert.equal(await pgApplySubscriptionEvent(id, { isActive: false }, event(id, "google"), {
      order: { field: "lastGoogleEventTime", timestamp: 4000, isDowngrade: true },
    }), "applied");
    assert.equal(new Date((await pgGetSubscription(id))?.lastGoogleEventTime).getTime(), 5000);
    assert.equal(await pgApplySubscriptionEvent(id, { isActive: true }, event(id, "google"), {
      order: { field: "lastGoogleEventTime", timestamp: 4500, isDowngrade: false },
    }), "stale");
    assert.equal((await pgGetSubscription(id))?.isActive, false);
  });

  it("rejects mismatched receipt ownership without recording or mutating either user", async (t) => {
    const id = await user(t);
    const other = await user(t);
    const delivery = event(other);
    await assert.rejects(pgApplySubscriptionEvent(id, { isActive: true }, delivery), /owner does not match/);
    assert.equal(await pgGetSubscription(id), null);
    assert.equal((await pool.query('SELECT count(*)::int count FROM payment_events WHERE provider_event_id=$1', [delivery.providerEventId])).rows[0].count, 0);
    assert.equal(await pgApplySubscriptionEvent(other, { isActive: true }, delivery), "applied");
  });

  it("rejects missing Stripe/Paddle signatures and Paddle verification returning false", async (t) => {
    const server = await webhookServer(t);
    assert.equal((await server.post("/api/webhooks/stripe", {})).status, 400);
    assert.equal((await server.post("/api/webhooks/paddle", {})).status, 400);
    assert.equal((await server.post("/api/webhooks/paddle", {}, {
      "paddle-signature": `ts=${Math.floor(Date.now() / 1000)};h1=${"0".repeat(64)}`,
    })).status, 400);
  });

  it("keeps Stripe checkout retries revoked after a newer signed deletion", async (t) => {
    const id = await user(t);
    const server = await webhookServer(t);
    const checkout = {
      id: `evt_${randomUUID()}`, object: "event", type: "checkout.session.completed", created: 1000,
      data: { object: {
        id: `cs_${randomUUID()}`, customer: "cus_test", subscription: `sub_${randomUUID()}`,
        payment_status: "paid", mode: "subscription",
        metadata: { userId: id, plan: "premium_monthly" }, amount_total: 999, currency: "eur",
      } },
    };
    const postStripe = (body: unknown) => server.post("/api/webhooks/stripe", body, { "stripe-signature": server.stripeHeader(body) });
    assert.equal((await postStripe(checkout)).status, 200);
    assert.equal((await pgGetSubscription(id))?.isActive, true);
    const deletion = {
      id: `evt_${randomUUID()}`, object: "event", type: "customer.subscription.deleted", created: 2000,
      data: { object: { id: checkout.data.object.subscription, metadata: { userId: id } } },
    };
    assert.equal((await postStripe(deletion)).status, 200);
    assert.equal((await postStripe(checkout)).status, 200);
    assert.equal((await pgGetSubscription(id))?.isActive, false);
    const distinctOldCheckout = { ...checkout, id: `evt_${randomUUID()}` };
    assert.equal((await postStripe(distinctOldCheckout)).body.skipped, "stale_event");
    assert.equal((await pgGetSubscription(id))?.isActive, false);
    const receipts = await pool.query("SELECT count(*)::int count FROM payment_events WHERE provider='stripe' AND provider_event_id=$1", [checkout.id]);
    assert.equal(receipts.rows[0].count, 1);
  });

  it("handles duplicate and distinct unwrapped Google deliveries with durable IDs", async (t) => {
    const id = await user(t);
    const secondId = await user(t);
    const server = await webhookServer(t);
    const token = `test-token-${randomUUID()}`;
    const secondToken = `test-token-${randomUUID()}`;
    await pgUpsertSubscription(id, { isActive: true, purchaseToken: token });
    await pgUpsertSubscription(secondId, { isActive: true, purchaseToken: secondToken });
    const payload = (purchaseToken: string) => ({
      version: "1.0", packageName: "test.radiohub", eventTimeMillis: "6000",
      voidedPurchaseNotification: { purchaseToken },
    });
    const endpoint = "/api/webhooks/google-play-rtdn?token=offline_google_integration";
    const duplicates = await Promise.all([server.post(endpoint, payload(token)), server.post(endpoint, payload(token))]);
    assert.deepEqual(duplicates.map((result) => result.status), [200, 200]);
    assert.equal(duplicates.filter((result) => result.body.skipped === "duplicate_message").length, 1);
    assert.equal((await server.post(endpoint, payload(secondToken))).status, 200);
    assert.equal((await pgGetSubscription(id))?.isActive, false);
    assert.equal((await pgGetSubscription(secondId))?.isActive, false);
    const receipts = await pool.query("SELECT count(*)::int count FROM payment_events WHERE event_type='voided' AND user_id=ANY($1::text[])", [[id, secondId]]);
    assert.equal(receipts.rows[0].count, 2);
  });

  function paddleEvent(userId: string, timestamp: number, eventType = "subscription.updated") {
    return { provider: "paddle" as const, providerEventId: `evt_${randomUUID()}`, userId,
      eventType, status: "processed", occurredAt: new Date(timestamp), payload: {} };
  }
  const paddleOrder = (timestamp: number, isDowngrade = false) => ({ field: "lastPaddleSubscriptionTime" as const, timestamp, isDowngrade });

  it("waits for deferred Stripe payment success and bounds zero-payment trial access", async (t) => {
    const id = await user(t), trialUser = await user(t), server = await webhookServer(t);
    const post = (body: any) => server.post("/api/webhooks/stripe", body, { "stripe-signature": server.stripeHeader(body) });
    const checkout = { id: `evt_${randomUUID()}`, object: "event", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000),
      data: { object: { id: `cs_${randomUUID()}`, customer: "cus_deferred", subscription: null, payment_status: "unpaid", mode: "payment",
        metadata: { userId: id, plan: "premium_lifetime" }, amount_total: 999, currency: "eur" } } };
    assert.equal((await post(checkout)).body.skipped, "awaiting_payment");
    assert.equal(await pgGetSubscription(id), null);
    const success = { ...checkout, id: `evt_${randomUUID()}`, type: "checkout.session.async_payment_succeeded", data: { object: { ...checkout.data.object, payment_status: "paid" } } };
    assert.equal((await post(success)).status, 200); assert.equal((await pgGetSubscription(id))?.isActive, true);
    assert.equal((await post(success)).status, 200);
    assert.equal((await pool.query("SELECT count(*)::int count FROM payment_events WHERE provider_event_id=$1", [success.id])).rows[0].count, 1);
    const trialEnd = Math.floor(Date.now() / 1000) + 86400;
    const trial = { ...checkout, id: `evt_${randomUUID()}`, data: { object: { ...checkout.data.object, payment_status: "no_payment_required", mode: "subscription",
      metadata: { userId: trialUser, plan: "premium_monthly" }, subscription: { id: "sub_trial", status: "trialing", trial_end: trialEnd } } } };
    assert.equal((await post(trial)).status, 200);
    const sub = await pgGetSubscription(trialUser);
    assert.equal(sub?.isActive, true); assert.equal(sub?.isTrial, true); assert.equal(sub?.expiresAt.getTime(), trialEnd * 1000);
    const setup = { ...trial, id: `evt_${randomUUID()}`, data: { object: { ...trial.data.object, mode: "setup" } } };
    assert.equal((await post(setup)).body.skipped, "awaiting_payment");
  });

  it("serializes first Paddle identity claims across two different users", async (t) => {
    const ids = [await user(t), await user(t)];
    const customerId = `ctm_${randomUUID()}`, subscriptionId = `sub_${randomUUID()}`;
    const results = await Promise.all(ids.map(id => pgApplySubscriptionEvent(id, {
      plan: "premium_monthly", platform: "paddle", paddleCustomerId: customerId, paddleSubscriptionId: subscriptionId, isActive: true,
    }, paddleEvent(id, 1000), { order: paddleOrder(1000), paddle: { customerId, subscriptionId, allowBinding: true, kind: "subscription" } })));
    assert.deepEqual(results.sort(), ["applied", "stale"]);
    assert.equal((await pool.query("SELECT count(*)::int count FROM subscriptions WHERE paddle_customer_id=$1", [customerId])).rows[0].count, 1);
  });

  it("ignores out-of-order Paddle downgrades while preserving other providers' late-revoke contract", async (t) => {
    const id = await user(t), customerId = `ctm_${randomUUID()}`, subscriptionId = `sub_${randomUUID()}`;
    await pgUpsertSubscription(id, { platform: "paddle", paddleCustomerId: customerId, paddleSubscriptionId: subscriptionId });
    const paddle = { customerId, subscriptionId, allowBinding: false, kind: "subscription" as const };
    await pgApplySubscriptionEvent(id, { isActive: true }, paddleEvent(id, 5000), { order: paddleOrder(5000), paddle });
    assert.equal(await pgApplySubscriptionEvent(id, { isActive: false }, paddleEvent(id, 4000, "subscription.canceled"), { order: paddleOrder(4000, true), paddle }), "stale");
    assert.equal((await pgGetSubscription(id))?.isActive, true);
  });

  it("cannot reactivate canceled recurring access from a later transaction completion", async (t) => {
    const id = await user(t), customerId = `ctm_${randomUUID()}`, subscriptionId = `sub_${randomUUID()}`;
    await pgUpsertSubscription(id, { platform: "paddle", paddleCustomerId: customerId, paddleSubscriptionId: subscriptionId, plan: "premium_monthly" });
    await pgApplySubscriptionEvent(id, { isActive: false, subscriptionStatus: "canceled" }, paddleEvent(id, 5000, "subscription.canceled"), {
      order: paddleOrder(5000, true), paddle: { customerId, subscriptionId, allowBinding: false, kind: "subscription" },
    });
    const transactionId = `txn_${randomUUID()}`;
    await pgApplySubscriptionEvent(id, { isActive: true, subscriptionStatus: "active", transactionId, expiresAt: new Date(Date.now() + 86400000) }, paddleEvent(id, 6000, "transaction.completed"), {
      order: { field: "lastPaddleTransactionTime", timestamp: 6000, isDowngrade: false },
      paddle: { customerId, subscriptionId, transactionId, allowBinding: false, kind: "transaction" },
    });
    const sub = await pgGetSubscription(id);
    assert.equal(sub?.isActive, false); assert.equal(sub?.subscriptionStatus, "canceled"); assert.equal(sub?.transactionId, transactionId);
  });

  it("does not let an obsolete subscription or refund overwrite the user's newer purchase", async (t) => {
    const id = await user(t), customerId = `ctm_${randomUUID()}`, subscriptionId = `sub_${randomUUID()}`;
    await pgUpsertSubscription(id, { platform: "paddle", paddleCustomerId: customerId, paddleSubscriptionId: subscriptionId, transactionId: "txn_current", plan: "premium_yearly", isActive: true });
    for (const paddle of [
      { customerId, subscriptionId: "sub_old", allowBinding: false, kind: "subscription" as const },
      { customerId, subscriptionId, transactionId: "txn_old", allowBinding: false, kind: "adjustment" as const },
    ]) assert.equal(await pgApplySubscriptionEvent(id, { isActive: false }, paddleEvent(id, 6000), { order: paddleOrder(6000, true), paddle }), "stale");
    assert.equal((await pgGetSubscription(id))?.isActive, true);
  });

  it("keeps approved full refunds revoked through same-subscription updates until another payment", async (t) => {
    const id = await user(t), customerId = `ctm_${randomUUID()}`, subscriptionId = `sub_${randomUUID()}`, transactionId = `txn_${randomUUID()}`;
    await pgUpsertSubscription(id, { platform: "paddle", paddleCustomerId: customerId, paddleSubscriptionId: subscriptionId, transactionId, isActive: true });
    const paddle = { customerId, subscriptionId, transactionId, allowBinding: false };
    await pgApplySubscriptionEvent(id, { isActive: false, paddleRefundedTransactionId: transactionId }, paddleEvent(id, 5000, "adjustment.updated"), {
      order: { field: "lastPaddleAdjustmentTime", timestamp: 5000, isDowngrade: true }, paddle: { ...paddle, kind: "adjustment" },
    });
    await pgApplySubscriptionEvent(id, { isActive: true, subscriptionStatus: "active", expiresAt: new Date(Date.now() + 86400000) }, paddleEvent(id, 6000), { order: paddleOrder(6000), paddle: { ...paddle, kind: "subscription" } });
    assert.equal((await pgGetSubscription(id))?.isActive, false);
    const nextTransaction = `txn_${randomUUID()}`;
    await pgApplySubscriptionEvent(id, { isActive: true, transactionId: nextTransaction }, paddleEvent(id, 7000, "transaction.completed"), {
      order: { field: "lastPaddleTransactionTime", timestamp: 7000, isDowngrade: false }, paddle: { ...paddle, transactionId: nextTransaction, kind: "transaction" },
    });
    assert.equal((await pgGetSubscription(id))?.isActive, true);
  });

  it("processes real locally signed Paddle checkout/lifecycle/replay events without client-plan escalation", async (t) => {
    const id = await user(t), server = await webhookServer(t);
    const { signedPaddleCustomData } = await import("../src/services/paddle-billing");
    const transactionId = `txn_${randomUUID()}`, customerId = `ctm_${randomUUID()}`, subscriptionId = `sub_${randomUUID()}`;
    const checkout = { event_id: `evt_${randomUUID()}`, event_type: "transaction.completed", occurred_at: new Date().toISOString(), data: {
      id: transactionId, customer_id: customerId, subscription_id: subscriptionId, status: "completed", origin: "web",
      items: [{ price: { id: "pri_offline_monthly", status: "active", billing_cycle: { interval: "month", frequency: 1 } }, quantity: 1 }],
      billing_period: { ends_at: new Date(Date.now() + 86400000).toISOString() },
      custom_data: signedPaddleCustomData("offline_paddle_integration", { userId: id, plan: "premium_monthly", priceId: "pri_offline_monthly" }),
    } };
    const post = (body: any) => server.post("/api/webhooks/paddle", body, { "paddle-signature": server.paddleHeader(body) });
    assert.equal((await post(checkout)).status, 200); assert.equal((await pgGetSubscription(id))?.isActive, true);
    const cancel = { ...checkout, event_id: `evt_${randomUUID()}`, event_type: "subscription.canceled", occurred_at: new Date(Date.now() + 1000).toISOString(),
      data: { id: subscriptionId, customer_id: customerId, status: "canceled", items: checkout.data.items } };
    assert.equal((await post(cancel)).status, 200); assert.equal((await pgGetSubscription(id))?.isActive, false);
    assert.equal((await post(checkout)).status, 200); assert.equal((await pgGetSubscription(id))?.isActive, false);
    assert.equal((await pool.query("SELECT count(*)::int count FROM payment_events WHERE provider='paddle' AND provider_event_id=$1", [checkout.event_id])).rows[0].count, 1);
  });
});
