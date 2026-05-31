#!/usr/bin/env tsx
/**
 * One-shot script: creates a test ApiUser + ApiKey so you can log in to
 * /api-user and verify the developer dashboard.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seed-api-test-user.ts
 *
 * Credentials printed to stdout — keep them safe.
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import { ApiUser, ApiKey } from '@workspace/db-shared/mongo-schemas';

const MONGO_URI =
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  'mongodb://localhost:27017/mega';

function generateApiKey(): string {
  const randomPart = crypto.randomBytes(24).toString('base64url');
  return `mr_${randomPart}`;
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const email = 'test-api-user@themegaradio.com';
  const password = 'TestApiUser2024!';

  // Remove any existing test user to allow re-runs
  const existing = await ApiUser.findOne({ email });
  if (existing) {
    await ApiKey.deleteMany({ userId: existing._id });
    await existing.deleteOne();
    console.log('Removed existing test user');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await ApiUser.create({
    email,
    passwordHash,
    name: 'Test Developer',
    company: 'MegaRadio QA',
    website: 'https://themegaradio.com',
    plan: 'pro',
    status: 'active',
  });

  // Create a free key with some synthetic usage so the admin table looks populated
  const freeRawKey = generateApiKey();
  const freeKey = await ApiKey.create({
    keyHash: hashKey(freeRawKey),
    keyPrefix: freeRawKey.substring(0, 7),
    name: 'Test Developer',
    email,
    appName: 'My Radio App',
    appUrl: 'https://example.com',
    usageReason: 'Testing the MegaRadio API',
    plan: 'free',
    status: 'active',
    rateLimitPerMin: 60,
    dailyQuota: 1000,
    monthlyQuota: 10000,
    usage: {
      todayCount: 42,
      monthCount: 317,
      totalCount: 1204,
      lastUsedAt: new Date(),
    },
    userId: user._id,
  });

  // Create a pro key (simulate an upgrade)
  const proRawKey = generateApiKey();
  const proKey = await ApiKey.create({
    keyHash: hashKey(proRawKey),
    keyPrefix: proRawKey.substring(0, 7),
    name: 'Test Developer',
    email,
    appName: 'My Radio App (Production)',
    appUrl: 'https://example.com',
    usageReason: 'Production traffic',
    plan: 'pro',
    status: 'active',
    rateLimitPerMin: 300,
    dailyQuota: 10000,
    monthlyQuota: 100000,
    usage: {
      todayCount: 1839,
      monthCount: 28471,
      totalCount: 93204,
      lastUsedAt: new Date(),
    },
    userId: user._id,
  });

  user.apiKeys = [freeKey._id as mongoose.Types.ObjectId, proKey._id as mongoose.Types.ObjectId];
  await user.save();

  console.log('\n========== TEST API USER CREATED ==========');
  console.log(`Email    : ${email}`);
  console.log(`Password : ${password}`);
  console.log(`Plan     : pro`);
  console.log('\nAPI Keys (save these — they are shown only once):');
  console.log(`  Free key : ${freeRawKey}`);
  console.log(`  Pro key  : ${proRawKey}`);
  console.log('\nLogin at: https://themegaradio.com/api-user');
  console.log('Admin view: https://themegaradio.com/admin/api-keys');
  console.log('===========================================\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
