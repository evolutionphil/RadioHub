# MegaRadio - Mobile Subscription Integration Guide (React Native)

## Overview
Backend API endpoints for managing user subscriptions from iOS/Android React Native apps.

**Base URL:** `https://themegaradio.com`

---

## Plan Structure

### Product ID to Plan Mapping
| Product ID (Store) | Plan Name | Type | Duration |
|---|---|---|---|
| `megaradio_remove_ads_yearly1` | `remove_ads` | Subscription (auto-renewable) | 1 Year |
| `megaradio_premium_monthly1` | `premium_monthly` | Subscription (auto-renewable) | 1 Month (7 day free trial) |
| `megaradio_premium_yearly` | `premium_yearly` | Subscription (auto-renewable) | 1 Year |
| `megaradio_premium_lifetime` | `premium_lifetime` | In-App Purchase (non-consumable) | Lifetime |

### Plan Feature Matrix
| Feature | none | remove_ads | premium_monthly | premium_yearly | premium_lifetime |
|---|---|---|---|---|---|
| remove_ads | - | YES | YES | YES | YES |
| song_info | - | - | YES | YES | YES |
| spotify_link | - | - | YES | YES | YES |
| youtube_link | - | - | YES | YES | YES |
| hd_stream | - | - | YES | YES | YES |
| song_history | - | - | YES | YES | YES |
| stream_record | - | - | YES | YES | YES |

### Plan Rank (for restore, highest wins)
`none(0) < remove_ads(1) < premium_monthly(2) < premium_yearly(3) < premium_lifetime(4)`

---

## Authentication
All subscription endpoints require the user to be logged in. Send the auth token in the `Authorization` header:

```
Authorization: Bearer <user_auth_token>
```

---

## API Endpoints

### 1. Report Subscription (After Purchase)
**`POST /api/user/subscription`**

Call this endpoint **immediately after a successful in-app purchase** on iOS or Android.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "platform": "ios",
  "productId": "megaradio_premium_monthly1",
  "plan": "premium_monthly",
  "transactionId": "1000000123456789",
  "originalTransactionId": "1000000123456789",
  "receipt": "<base64_receipt_data>",
  "purchaseToken": "<google_play_purchase_token>",
  "expiresAt": "2026-05-01T00:00:00.000Z",
  "isTrial": false
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | YES | `"ios"` or `"android"` |
| `productId` | string | YES | Store product ID (e.g., `megaradio_premium_monthly1`) |
| `transactionId` | string | YES | Transaction ID from Apple/Google |
| `plan` | string | no | Plan name. If omitted, auto-resolved from productId |
| `originalTransactionId` | string | no | Original transaction ID (for renewals, iOS) |
| `receipt` | string | no | Apple receipt data (base64) or Google receipt |
| `purchaseToken` | string | no | Android only - Google Play purchase token |
| `expiresAt` | string (ISO 8601) | no | When the subscription expires. Auto-calculated if omitted |
| `isTrial` | boolean | no | `true` if this is a free trial period |

**Note:** If `plan` is not sent, the backend automatically resolves it from `productId` using the mapping table above.

**Response (200):**
```json
{
  "success": true,
  "plan": "premium_monthly",
  "expiryDate": "2026-05-01T00:00:00.000Z",
  "isActive": true,
  "features": ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"]
}
```

**For lifetime purchases, `expiryDate` is `null`:**
```json
{
  "success": true,
  "plan": "premium_lifetime",
  "expiryDate": null,
  "isActive": true,
  "features": ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"]
}
```

---

### 2. Check Current Subscription (App Launch)
**`GET /api/user/subscription`**

Call this on every app launch to sync subscription status. The server automatically marks expired subscriptions as inactive (except lifetime).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (active subscription):**
```json
{
  "plan": "premium_monthly",
  "expiryDate": "2026-05-01T00:00:00.000Z",
  "isActive": true,
  "features": ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"]
}
```

**Response (no subscription):**
```json
{
  "plan": "none",
  "expiryDate": null,
  "isActive": false,
  "features": []
}
```

**Response (expired):**
```json
{
  "plan": "none",
  "expiryDate": null,
  "isActive": false,
  "features": [],
  "expired": true
}
```

---

### 3. Cancel Subscription
**`POST /api/user/subscription/cancel`**

Call when the user cancels. Note: Actual App Store/Play Store cancellation is handled by the user through their device settings.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "plan": "none",
  "isActive": false,
  "features": []
}
```

---

## React Native Integration

### Purchase Flow
```typescript
import * as RNIap from 'react-native-iap';
import { Platform } from 'react-native';

const PRODUCT_TO_PLAN: Record<string, string> = {
  'megaradio_remove_ads_yearly1': 'remove_ads',
  'megaradio_premium_monthly1': 'premium_monthly',
  'megaradio_premium_yearly': 'premium_yearly',
  'megaradio_premium_lifetime': 'premium_lifetime',
};

const reportSubscription = async (
  purchase: RNIap.Purchase,
  authToken: string
) => {
  const plan = PRODUCT_TO_PLAN[purchase.productId] || 'premium_monthly';

  const response = await fetch('https://themegaradio.com/api/user/subscription', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      platform: Platform.OS,
      productId: purchase.productId,
      plan,
      transactionId: purchase.transactionId,
      originalTransactionId: purchase.originalTransactionIdIOS || purchase.transactionId,
      receipt: Platform.OS === 'ios' ? purchase.transactionReceipt : undefined,
      purchaseToken: Platform.OS === 'android' ? purchase.purchaseToken : undefined,
      isTrial: false,
    }),
  });

  const data = await response.json();

  if (data.success) {
    if (Platform.OS === 'ios') {
      await RNIap.finishTransaction({ purchase });
    } else {
      await RNIap.acknowledgePurchaseAndroid({ token: purchase.purchaseToken! });
    }
  }

  return data;
};
```

### Check on App Launch
```typescript
const checkSubscription = async (authToken: string) => {
  const response = await fetch('https://themegaradio.com/api/user/subscription', {
    headers: { 'Authorization': `Bearer ${authToken}` },
  });
  const data = await response.json();
  // data.plan => 'none' | 'remove_ads' | 'premium_monthly' | 'premium_yearly' | 'premium_lifetime'
  // data.isActive => true | false
  // data.features => ['remove_ads', 'song_info', ...] or []
  return data;
};
```

### Listen for Renewals
```typescript
useEffect(() => {
  const purchaseUpdateSub = RNIap.purchaseUpdatedListener(async (purchase) => {
    await reportSubscription(purchase, authToken);
  });

  const purchaseErrorSub = RNIap.purchaseErrorListener((error) => {
    console.warn('Purchase error:', error);
  });

  return () => {
    purchaseUpdateSub.remove();
    purchaseErrorSub.remove();
  };
}, []);
```

---

## Error Responses

| Status | Body | Meaning |
|--------|------|---------|
| 400 | `{ "error": "platform must be ios or android" }` | Invalid platform |
| 400 | `{ "error": "productId and transactionId are required" }` | Missing required fields |
| 400 | `{ "error": "Unknown productId: ..." }` | productId not in mapping table |
| 401 | `{ "error": "Not authenticated" }` | Auth token missing or invalid |
| 404 | `{ "error": "User not found" }` | User deleted or invalid token |
| 500 | `{ "error": "Failed to update subscription" }` | Server error |

---

## Important Notes

1. **productId and transactionId are required** for all purchase reports.

2. **plan field is optional** - if omitted, auto-resolved from productId. If sent, must match: `none`, `remove_ads`, `premium_monthly`, `premium_yearly`, `premium_lifetime`.

3. **Lifetime purchases** have `expiryDate: null` and never expire.

4. **Auto-expiry**: Server automatically marks non-lifetime subscriptions as expired when `expiresAt` is past. Check on every app launch with `GET /api/user/subscription`.

5. **Duplicate prevention**: If the same `transactionId` is reported twice, the second call returns the existing subscription without modification.

6. **Restore purchases**: After `getAvailablePurchases()`, report each purchase to the backend. The backend stores the latest state.

7. **remove_ads plan**: Only removes ads. Does NOT unlock premium features (song_info, hd_stream, etc.).

8. **Default prices** (fallback): Remove Ads = 5.99/yr, Premium Monthly = 3.99/mo, Premium Yearly = 29.99/yr, Lifetime = 59.99 one-time.
