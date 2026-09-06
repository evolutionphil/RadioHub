#!/usr/bin/env tsx
/**
 * Explicit, additive PostgreSQL developer-dashboard fixture.
 * Set DATABASE_URL, API_TEST_EMAIL, API_TEST_PASSWORD and run:
 * pnpm --filter @workspace/api-server exec tsx src/scripts/seed-api-test-user.ts
 * Refuses production and never deletes/replaces an existing account.
 * Newly generated API keys are printed once; the password is never printed.
 */
import bcrypt from 'bcrypt';
import { closePostgres, getPostgresPool } from '../postgres-runtime';
import { pgFindApiDeveloperByEmail, pgIssueApiKey, pgRegisterApiDeveloper, pgRevokeApiDeveloperSession } from '../data/postgres-api-access-store';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Test user seeding is disabled in production');
  const email = process.env.API_TEST_EMAIL?.trim().toLowerCase();
  const password = process.env.API_TEST_PASSWORD || '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72)
    throw new Error('Set API_TEST_EMAIL and API_TEST_PASSWORD (12+ characters, at most 72 UTF-8 bytes)');
  if (await pgFindApiDeveloperByEmail(email)) throw new Error('Account already exists; no existing data was changed');
  const fixture = await pgRegisterApiDeveloper({ email, name: 'Test Developer',
    passwordHash: await bcrypt.hash(password, 10), company: 'MegaRadio QA', website: 'https://example.invalid' });
  await pgRevokeApiDeveloperSession(fixture.token);
  await getPostgresPool().query("UPDATE api_developer_users SET plan='pro' WHERE id=$1", [fixture.user._id]);
  const pro = await pgIssueApiKey({ email, name: 'Test Developer', userId: fixture.user._id, plan: 'pro',
    appName: 'Test App (Pro)', appUrl: 'https://example.invalid', usageReason: 'Developer dashboard testing' });
  console.log('Test developer created:', email);
  console.log('Free API key (shown once):', fixture.apiKey);
  console.log('Pro API key (shown once):', pro.apiKey);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(closePostgres);
