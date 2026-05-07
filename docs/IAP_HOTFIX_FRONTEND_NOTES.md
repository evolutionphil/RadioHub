# IAP Hotfix — Frontend / Mobile Developer Notes

**Date:** 2026-05-07
**Reason:** P0 security hotfix — the old `/api/user/subscription` POST trusted
client-supplied plan/expiry/transaction fields, which let any logged-in user
grant themselves Premium by sending a fake JSON body. It is now closed.

The contract changed in 4 places. Read the matching section before shipping.

---

## 1. `POST /api/user/subscription` — now requires a real receipt

**Before:** mobile client could send `{ plan, productId, expiryDate, ... }` and
the server would write them straight into the DB.

**After:** server only accepts:

```json
{
  "platform": "ios" | "macos" | "tvos" | "android" | "mac",
  "productId": "megaradio_premium_yearly",
  "receipt":  "<base64 unifiedReceipt>",        // iOS/macOS/tvOS
  "purchaseToken": "<google purchase token>",   // Android
  "originalTransactionId": "<optional>",
  "autoRenewing": true
}
```

The server then:
- calls Apple verifyReceipt or Google Play developer API,
- derives `plan`, `expiryDate`, `productId`, `originalTransactionId` from the
  verified response (your fields are ignored if you send them),
- runs a **replay guard**: same `originalTransactionId` (iOS) or `purchaseToken`
  (Android) on a different user account → `409 receipt_replay`.

**Error responses to handle:**

| Status | `error` value           | Meaning                                                      |
|--------|-------------------------|--------------------------------------------------------------|
| 400    | `missing_receipt`       | No receipt/token in body                                     |
| 400    | `unknown_product`       | productId not in our PRODUCT_TO_PLAN catalog                 |
| 401    | `invalid_receipt`       | Apple/Google rejected the receipt                            |
| 409    | `receipt_replay`        | Receipt already bound to a different user                    |
| 422    | `productId_mismatch`    | Receipt productId ≠ body productId                           |
| 502    | `verify_unreachable`    | Apple/Google API timeout — retry safe                        |

**FAKE strings (e.g. `"FAKE"`, `"test"`, anything not from StoreKit/Play
Billing) → 401.** Do not send placeholders even from QA builds.

`platform: "mac"` is accepted and normalized to `"macos"` server-side; both
work, prefer `"macos"` going forward.

---

## 2. `POST /api/user/subscription/cancel` — store-billed users get 409

For App Store / Play Store subscriptions, **we cannot cancel for the user** —
Apple/Google manage the recurring billing. The server now refuses to flip
`isActive` to false for those plans:

```http
HTTP/1.1 409 Conflict
{
  "error": "manage_in_store",
  "code": "manage_in_store",
  "actionRequired": "open_store_subscriptions",
  "platform": "ios",
  "manageUrl": "https://apps.apple.com/account/subscriptions"
                // or "https://play.google.com/store/account/subscriptions?sku=..."
}
```

**Mobile client must:**
1. Detect `code === "manage_in_store"`,
2. Open `manageUrl` via deep-link (`Linking.openURL` / `SKPaymentQueue
   .canMakePayments` flow on iOS).
3. Show user something like “Aboneliğiniz App Store/Play Store üzerinden
   yönetilir. Açılan ekrandan iptal edebilirsiniz.”

`lifetime`, admin-granted, and web (Stripe-style) cancels still succeed with
`200`.

---

## 3. New: `DELETE /api/admin/users/:id/subscription` (admin only)

Hard-revoke for admin support. Wipes plan, platform, productId, txn id,
receipt, token, expiry. Writes an `IapEvent` audit row with `providerCode:
"admin_revoke"`. Use from the admin dashboard “Revoke subscription” action.

Returns `{ success: true, userId, email }` on `200`.

---

## 4. Apple S2S notifications — new endpoint

`POST /api/iap/apple-webhook` is the new App Store Server Notifications V2
receiver. Configure in App Store Connect:

```
Production Server URL: https://<your-domain>/api/iap/apple-webhook
Sandbox Server URL:    https://<your-domain>/api/iap/apple-webhook
Version:               Version 2 Notifications
```

It validates the JWS signature, walks the x5c cert chain, pins to **Apple Root
CA G3** by SHA-256 fingerprint, then handles SUBSCRIBED / DID_RENEW / EXPIRED /
REFUND / REVOKE / GRACE_PERIOD_EXPIRED / DID_FAIL_TO_RENEW idempotently
(`notificationUUID` dedupe + `signedDate` ordering guard).

**You should set this env var in production** (defense-in-depth — without it
the webhook still verifies signatures but skips bundle binding):

```
APPLE_EXPECTED_BUNDLE_IDS=com.megaradio.app,com.megaradio.app.tvos
```

(Comma-separated. Use the bundle IDs registered in App Store Connect.)

---

## Test user cleanup

The fake premium granted to `testuser2026@megaradio.test` during the exploit
window can be cleared with:

```bash
mongosh "$MONGODB_URI" artifacts/api-server/scripts/cleanup-test-user-2026.js
```

Script is idempotent and prints before/after.
