// Run with: mongosh "$MONGODB_URI" artifacts/api-server/scripts/cleanup-test-user-2026.js
// Purpose: clear the entitlement that the old (exploitable) /api/user/subscription
// route granted to testuser2026@megaradio.test before the P0 hotfix.

const EMAIL = "testuser2026@megaradio.test";

const before = db.users.findOne({ email: EMAIL }, { email: 1, subscription: 1 });
print("BEFORE: " + JSON.stringify(before, null, 2));

const result = db.users.updateOne(
  { email: EMAIL },
  {
    $set: {
      "subscription.plan": "none",
      "subscription.isActive": false,
      "subscription.features": [],
    },
    $unset: {
      "subscription.platform": "",
      "subscription.productId": "",
      "subscription.originalTransactionId": "",
      "subscription.transactionId": "",
      "subscription.purchaseToken": "",
      "subscription.receiptData": "",
      "subscription.purchaseDate": "",
      "subscription.expiryDate": "",
      "subscription.lastVerifiedAt": "",
      "subscription.lastSignedDate": "",
      "subscription.autoRenewing": "",
    },
  },
);
print("UPDATE RESULT: " + JSON.stringify(result));

// Audit row so the action is visible in the IAP events admin panel.
db.iapevents.insertOne({
  userId: before ? before._id : null,
  platform: "ios",
  productId: "",
  originalTransactionId: "",
  transactionId: "",
  result: "manual_cleanup",
  providerCode: "p0_hotfix_revert",
  statusCode: 200,
  errorMessage: "Cleared fake entitlement granted by pre-hotfix /api/user/subscription POST",
  ip: "127.0.0.1",
  userAgent: "cleanup-script",
  durationMs: 0,
  createdAt: new Date(),
});

const after = db.users.findOne({ email: EMAIL }, { email: 1, subscription: 1 });
print("AFTER: " + JSON.stringify(after, null, 2));
