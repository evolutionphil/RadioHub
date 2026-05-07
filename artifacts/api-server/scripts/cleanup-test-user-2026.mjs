import mongoose from "mongoose";

const EMAIL = "testuser2026@megaradio.test";
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set");
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

const before = await db.collection("users").findOne(
  { email: EMAIL },
  { projection: { email: 1, subscription: 1 } },
);
console.log("BEFORE:", JSON.stringify(before, null, 2));

if (!before) {
  console.log("User not found — nothing to do.");
  await mongoose.disconnect();
  process.exit(0);
}

const result = await db.collection("users").updateOne(
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
console.log("UPDATE RESULT:", JSON.stringify(result));

await db.collection("iapevents").insertOne({
  userId: before._id,
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

const after = await db.collection("users").findOne(
  { email: EMAIL },
  { projection: { email: 1, subscription: 1 } },
);
console.log("AFTER:", JSON.stringify(after, null, 2));

await mongoose.disconnect();
console.log("Done.");
