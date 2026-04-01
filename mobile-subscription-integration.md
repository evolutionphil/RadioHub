# MegaRadio - Mobile Subscription Integration Guide

## Overview
Backend API endpoints for managing user subscriptions from iOS/Android (React Native) apps.

**Base URL:** `https://themegaradio.com`

---

## Authentication
All subscription endpoints require the user to be logged in. Send the auth token in the `Authorization` header:

```
Authorization: Bearer <user_auth_token>
```

The auth token is obtained after login (Google OAuth or email/password login).

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
  "plan": "premium",
  "platform": "ios",
  "productId": "com.megaradio.premium.monthly",
  "transactionId": "1000000123456789",
  "originalTransactionId": "1000000123456789",
  "expiresAt": "2026-05-01T00:00:00.000Z",
  "isTrial": false
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `plan` | string | YES | `"premium"` or `"pro"` |
| `platform` | string | YES | `"ios"` or `"android"` |
| `productId` | string | YES | Store product ID (e.g., `com.megaradio.premium.monthly`) |
| `transactionId` | string | YES | Transaction ID from Apple/Google |
| `originalTransactionId` | string | no | Original transaction ID (for renewals, iOS) |
| `expiresAt` | string (ISO 8601) | no | When the subscription expires |
| `isTrial` | boolean | no | `true` if this is a free trial |

**Response (200):**
```json
{
  "success": true,
  "subscription": {
    "plan": "premium",
    "platform": "ios",
    "productId": "com.megaradio.premium.monthly",
    "transactionId": "1000000123456789",
    "expiresAt": "2026-05-01T00:00:00.000Z",
    "startedAt": "2026-04-01T12:00:00.000Z",
    "isTrial": false,
    "isActive": true,
    "lastVerifiedAt": "2026-04-01T12:00:00.000Z"
  }
}
```

---

### 2. Check Current Subscription
**`GET /api/user/subscription`**

Call this on app launch and periodically to verify subscription status. The server automatically marks expired subscriptions as inactive.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "subscription": {
    "plan": "premium",
    "platform": "ios",
    "isActive": true,
    "expiresAt": "2026-05-01T00:00:00.000Z",
    "isTrial": false
  }
}
```

**If expired:**
```json
{
  "subscription": {
    "plan": "free",
    "isActive": false,
    "expired": true
  }
}
```

---

### 3. Cancel Subscription
**`POST /api/user/subscription/cancel`**

Call this when the user cancels their subscription from within the app. Note: This only updates the backend record. The actual App Store/Play Store cancellation must be handled separately by the user.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "subscription": {
    "plan": "free",
    "isActive": false,
    "cancelledAt": "2026-04-01T12:00:00.000Z"
  }
}
```

---

## React Native Integration Example

### 1. Install `react-native-iap`
```bash
npm install react-native-iap
# or
yarn add react-native-iap
```

### 2. Purchase Flow (iOS & Android)
```typescript
import * as RNIap from 'react-native-iap';
import { Platform } from 'react-native';

// Product IDs (define these in App Store Connect / Google Play Console)
const PRODUCT_IDS = {
  premium_monthly: 'com.megaradio.premium.monthly',
  premium_yearly: 'com.megaradio.premium.yearly',
  pro_monthly: 'com.megaradio.pro.monthly',
  pro_yearly: 'com.megaradio.pro.yearly',
};

// Initialize on app start
await RNIap.initConnection();

// Get available products
const products = await RNIap.getSubscriptions({
  skus: Object.values(PRODUCT_IDS),
});

// Purchase
const purchase = await RNIap.requestSubscription({
  sku: PRODUCT_IDS.premium_monthly,
});
```

### 3. Report Purchase to Backend
```typescript
const reportSubscription = async (
  purchase: RNIap.Purchase,
  plan: 'premium' | 'pro',
  authToken: string
) => {
  const platform = Platform.OS; // 'ios' or 'android'

  const response = await fetch('https://themegaradio.com/api/user/subscription', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      plan,
      platform,
      productId: purchase.productId,
      transactionId: purchase.transactionId,
      originalTransactionId: purchase.originalTransactionIdIOS || purchase.transactionId,
      expiresAt: purchase.transactionDate
        ? new Date(Number(purchase.transactionDate) + 30 * 24 * 60 * 60 * 1000).toISOString()
        : undefined,
      isTrial: false,
    }),
  });

  const data = await response.json();

  if (data.success) {
    // Acknowledge the purchase (important!)
    if (Platform.OS === 'ios') {
      await RNIap.finishTransaction({ purchase });
    } else {
      await RNIap.acknowledgePurchaseAndroid({
        token: purchase.purchaseToken!,
      });
    }
  }

  return data;
};
```

### 4. Check Subscription on App Launch
```typescript
const checkSubscription = async (authToken: string) => {
  const response = await fetch('https://themegaradio.com/api/user/subscription', {
    headers: {
      'Authorization': `Bearer ${authToken}`,
    },
  });

  const data = await response.json();
  // data.subscription.plan => 'free' | 'premium' | 'pro'
  // data.subscription.isActive => true | false
  return data.subscription;
};
```

### 5. Listen for Subscription Updates (Renewals/Cancellations)
```typescript
useEffect(() => {
  const purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
    async (purchase) => {
      const plan = purchase.productId.includes('pro') ? 'pro' : 'premium';
      await reportSubscription(purchase, plan, authToken);
    }
  );

  const purchaseErrorSubscription = RNIap.purchaseErrorListener(
    (error) => {
      console.warn('Purchase error:', error);
    }
  );

  return () => {
    purchaseUpdateSubscription.remove();
    purchaseErrorSubscription.remove();
  };
}, []);
```

---

## Subscription Plans

| Plan | Features |
|------|----------|
| `free` | Default. Ads shown, basic features. |
| `premium` | No ads, higher audio quality, offline favorites. |
| `pro` | All premium features + unlimited skips, exclusive content. |

---

## Error Responses

| Status | Body | Meaning |
|--------|------|---------|
| 400 | `{ "error": "plan and platform are required" }` | Missing required fields |
| 400 | `{ "error": "plan must be free, premium, or pro" }` | Invalid plan value |
| 401 | `{ "error": "Not authenticated" }` | Auth token missing or invalid |
| 404 | `{ "error": "User not found" }` | User deleted or invalid token |
| 500 | `{ "error": "Failed to update subscription" }` | Server error |

---

## Important Notes for Mobile Developer

1. **Always report after purchase**: Call `POST /api/user/subscription` immediately after a successful in-app purchase, before calling `finishTransaction`.

2. **Check on every app launch**: Call `GET /api/user/subscription` on app start to sync status. The server auto-expires subscriptions past their `expiresAt` date.

3. **Handle renewals**: Use `purchaseUpdatedListener` to catch automatic renewals and report them to the backend.

4. **Cancellation**: When a user cancels via App Store/Play Store settings, the subscription stays active until `expiresAt`. On next check, the server marks it as expired.

5. **Transaction IDs are important**: Send `transactionId` and `originalTransactionId` so the backend can track renewals and prevent duplicate entries.

6. **Product IDs**: You need to create these subscription products in App Store Connect (iOS) and Google Play Console (Android) with matching IDs.

7. **Testing**: Use sandbox accounts on iOS and test accounts on Android for testing purchases without real charges.
