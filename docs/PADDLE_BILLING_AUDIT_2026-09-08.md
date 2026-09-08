# Paddle billing audit — 2026-09-08

Scope: backend billing routes/native subscription state, bounded read-only configuration/catalog checks, and isolated local regressions. No production payment, portal session, subscription, webhook simulation, credential, or catalog mutation was performed.

## Confirmed defects repaired

- `transaction.completed` previously trusted client-editable `custom_data.plan` and created recurring rights with no expiry. New checkouts bind user/plan/price/TV issuance with an HMAC; fulfillment checks actual line items against configured prices. Inactive/ambiguous/wrong-period prices cannot initiate checkout.
- Paddle subscription lifecycle now handles created/active/trial/resumed/updated/past-due/paused/canceled states. Access is bounded to the provider billing period; scheduled cancellation retains that paid period. Existing past-due grace does not extend beyond it.
- Native row/advisory locks bind provider identities to one user. Durable event IDs prevent replay; Paddle occurrence-time guards reject stale changes. Lifecycle state cannot be overwritten by delayed transaction completion. Other providers retain their existing late-revocation behavior.
- Approved full refunds affect only their exact current transaction. Partial/tax/pending refunds do not cancel all rights. Unknown refund ownership returns a retryable failure; old/unrelated transactions require review. A later verified payment can release a previous-period refund hold without reviving a canceled subscription.
- Raw Paddle webhook bodies fail closed if missing; no JSON reserialization fallback. Administrative debug output no longer returns key/token prefixes.
- Checkout preserves one of the 14 allowed locale paths and rejects already-active entitlements to avoid a second payment. Authenticated portal creation uses native customer ownership, never request-supplied IDs; portal URLs are not cached or logged.
- Public plan amounts/periods come from verified Paddle catalog GETs. Unavailable prices return amount `0` **with checkout disabled**, not invented fallback amounts. Shared 60-second cache, at most two concurrent GETs and 2.5-second request timeouts bound catalog traffic.
- Public TV web-code checks remain status-only. Actual device-bound replies now consult native entitlement/expiry rather than an old code's plan.
- Stripe unpaid checkout completion no longer grants rights. `checkout.session.async_payment_succeeded` fulfills the later payment; zero-payment trials require a verified finite subscription period, and setup-only sessions grant nothing.

## Verified and remaining operational requirements

- 39 focused tests passed: 23 decision/catalog/HTTP contract tests plus 16 real PostgreSQL integration tests in a disposable random schema. No skips. API TypeScript check passed. Fixture schema/pools were removed/closed and task-local PostgreSQL stopped.
- Read-only production configuration was **Paddle sandbox**, with API key, webhook secret and client token present. Four configured prices returned HTTP **403 / forbidden**. Actual amounts and intervals could not be verified. No setting/key was changed; this result does not establish whether the cause is key permissions, account state or another provider restriction.
- Production readiness still requires the owner to configure/verify the intended Paddle environment and valid catalog access. Confirm the destination subscribes to `transaction.completed`, relevant `subscription.*` events and `adjustment.created`/`adjustment.updated`. Event destination configuration was not changed or independently verified.
- Previously unlinked/unsigned in-flight checkouts now require review instead of trusting their client-supplied user/plan. Existing native-linked subscription lifecycle remains supported. No old subscription data was bulk rewritten; old indefinite entitlements require an authorized provider reconciliation if they predate the repaired events.

## Primary references

- [Paddle signature verification](https://developer.paddle.com/webhooks/about/signature-verification/)
- [Paddle delivery and event ordering](https://developer.paddle.com/webhooks/about/how-webhooks-work/)
- [Paddle subscription lifecycle payload](https://developer.paddle.com/webhooks/subscriptions/subscription-updated/)
- [Paddle completed transactions](https://developer.paddle.com/webhooks/transactions/transaction-completed/)
- [Paddle approved adjustments](https://developer.paddle.com/webhooks/adjustments/adjustment-updated/)
- [Paddle customer portal sessions](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/)
- [Stripe deferred-payment fulfillment](https://docs.stripe.com/checkout/fulfillment)
