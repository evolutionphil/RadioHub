/**
 * Regression tests for the admin blacklist audit emails.
 *
 * The blacklist add/remove audit emails follow the same fire-and-forget
 * pattern as the existing flush/remove-streams audit emails. They have two
 * pieces worth pinning down:
 *
 *   1. `buildBlacklistChangesCsv` — shapes the CSV header + body for both
 *      'add' and 'remove' actions, handles empty rows, and applies CSV
 *      escaping for embedded commas / quotes / newlines.
 *   2. `emailBlacklistChangesCsv` — the wrapper that decides the subject
 *      line, email title, filename prefix, and singular/plural copy
 *      before delegating to the generic `sendAdminAuditEmail`.
 *
 * If someone later tweaks the wrapper (or removes the import call so it
 * silently no-ops), these tests will catch the regression.
 *
 * Runner: requires `--experimental-test-module-mocks` (wired up in
 * artifacts/api-server/package.json#scripts.test) so we can swap out
 * `@sendgrid/mail` for a spy without touching SendGrid.
 */
import { test, mock, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stub `@sendgrid/mail` before the audit-email module is imported. Both
// `setApiKey` and `send` become no-op spies so we can inspect the rendered
// subject / attachment filename without touching the network.
// ---------------------------------------------------------------------------

interface CapturedSendArgs {
  subject?: string;
  filenames: string[];
  to?: unknown;
  text?: string;
  html?: string;
}

const sentMessages: CapturedSendArgs[] = [];

const fakeSgMail = {
  setApiKey: (_key: string) => {},
  send: async (msg: {
    subject?: string;
    to?: unknown;
    text?: string;
    html?: string;
    attachments?: Array<{ filename: string }>;
  }) => {
    sentMessages.push({
      subject: msg.subject,
      filenames: (msg.attachments ?? []).map((a) => a.filename),
      to: msg.to,
      text: msg.text,
      html: msg.html,
    });
    return [{ statusCode: 202 } as unknown, {} as unknown] as const;
  },
};

mock.module('@sendgrid/mail', {
  defaultExport: fakeSgMail,
  namedExports: { default: fakeSgMail },
});

// ---------------------------------------------------------------------------
// Env setup. The wrapper short-circuits unless both recipients and an API
// key are set, so we configure both for the duration of the test file and
// restore the originals on exit.
// ---------------------------------------------------------------------------

const ORIGINAL_RECIPIENTS = process.env.ADMIN_AUDIT_EMAIL_RECIPIENTS;
const ORIGINAL_API_KEY = process.env.SENDGRID_API_KEY;
const ORIGINAL_FROM = process.env.ADMIN_AUDIT_EMAIL_FROM;

before(() => {
  process.env.ADMIN_AUDIT_EMAIL_RECIPIENTS = 'audit@example.com';
  process.env.SENDGRID_API_KEY = 'test-key';
  process.env.ADMIN_AUDIT_EMAIL_FROM = 'noreply@example.com';
});

after(() => {
  if (ORIGINAL_RECIPIENTS === undefined) {
    delete process.env.ADMIN_AUDIT_EMAIL_RECIPIENTS;
  } else {
    process.env.ADMIN_AUDIT_EMAIL_RECIPIENTS = ORIGINAL_RECIPIENTS;
  }
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.SENDGRID_API_KEY;
  } else {
    process.env.SENDGRID_API_KEY = ORIGINAL_API_KEY;
  }
  if (ORIGINAL_FROM === undefined) {
    delete process.env.ADMIN_AUDIT_EMAIL_FROM;
  } else {
    process.env.ADMIN_AUDIT_EMAIL_FROM = ORIGINAL_FROM;
  }
});

afterEach(() => {
  sentMessages.length = 0;
});

// Today's date stamp, matching the format the wrapper uses for filenames.
function todayStamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// buildBlacklistChangesCsv
// ---------------------------------------------------------------------------

test('buildBlacklistChangesCsv: action="add" labels rows as "blacklisted"', async () => {
  const { buildBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  const csv = buildBlacklistChangesCsv('add', [
    {
      name: 'Radio One',
      url: 'https://example.com/one.mp3',
      stationUuid: 'uuid-1',
      country: 'France',
      countryCode: 'FR',
      reason: 'dead stream',
    },
  ]);

  const lines = csv.split('\r\n');
  assert.equal(
    lines[0],
    'Action,Name,URL,Station UUID,Country,Country Code,Reason',
  );
  assert.equal(
    lines[1],
    'blacklisted,Radio One,https://example.com/one.mp3,uuid-1,France,FR,dead stream',
  );
  assert.equal(lines.length, 2);
});

test('buildBlacklistChangesCsv: action="remove" labels rows as "unblacklisted"', async () => {
  const { buildBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  const csv = buildBlacklistChangesCsv('remove', [
    {
      name: 'Radio Two',
      url: 'https://example.com/two.mp3',
      stationUuid: 'uuid-2',
    },
  ]);

  const lines = csv.split('\r\n');
  assert.equal(
    lines[1],
    'unblacklisted,Radio Two,https://example.com/two.mp3,uuid-2,,,',
  );
});

test('buildBlacklistChangesCsv: empty row list still emits the header row', async () => {
  const { buildBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  const csv = buildBlacklistChangesCsv('add', []);
  assert.equal(csv, 'Action,Name,URL,Station UUID,Country,Country Code,Reason');
});

test('buildBlacklistChangesCsv: missing optional fields render as empty cells', async () => {
  const { buildBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  const csv = buildBlacklistChangesCsv('add', [
    { name: 'Bare', url: 'https://x/y' },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], 'blacklisted,Bare,https://x/y,,,,');
});

test('buildBlacklistChangesCsv: escapes commas, quotes, and newlines in cell values', async () => {
  const { buildBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  const csv = buildBlacklistChangesCsv('add', [
    {
      name: 'Comma, Station',
      url: 'https://example.com/a,b',
      stationUuid: 'uuid-3',
      country: 'He said "hi"',
      countryCode: 'XX',
      reason: 'line1\nline2',
    },
  ]);

  // Newlines inside a quoted field stay literal, so the body is everything
  // after the header line.
  const headerLen = 'Action,Name,URL,Station UUID,Country,Country Code,Reason\r\n'.length;
  const body = csv.slice(headerLen);
  assert.equal(
    body,
    'blacklisted,"Comma, Station","https://example.com/a,b",uuid-3,"He said ""hi""",XX,"line1\nline2"',
  );
});

// ---------------------------------------------------------------------------
// emailBlacklistChangesCsv
// ---------------------------------------------------------------------------

test('emailBlacklistChangesCsv: skips entirely when rows is empty', async () => {
  const { emailBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  await emailBlacklistChangesCsv({
    action: 'add',
    source: 'single deletion',
    rows: [],
  });

  assert.equal(sentMessages.length, 0, 'should not send mail for empty input');
});

test('emailBlacklistChangesCsv: action="add" + 1 row → singular subject/title/filename', async () => {
  const { emailBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  await emailBlacklistChangesCsv({
    action: 'add',
    source: 'single deletion',
    rows: [{ name: 'Radio One', url: 'https://example.com/one.mp3' }],
    actorEmail: 'admin@example.com',
  });

  assert.equal(sentMessages.length, 1);
  const msg = sentMessages[0];
  assert.match(
    msg.subject ?? '',
    /^\[MegaRadio\]\[[^\]]+\] Blacklisted 1 station \(single deletion\)$/,
  );
  assert.deepEqual(msg.filenames, [`stations-blacklisted-${todayStamp()}.csv`]);
  assert.match(msg.html ?? '', /<h2>Blacklisted stations<\/h2>/);
  assert.match(msg.text ?? '', /1 station was blacklisted via single deletion\./);
  assert.match(msg.text ?? '', /Triggered by: admin@example\.com/);
});

test('emailBlacklistChangesCsv: action="add" + many rows → plural subject/summary', async () => {
  const { emailBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  await emailBlacklistChangesCsv({
    action: 'add',
    source: 'bulk deletion',
    rows: [
      { name: 'A', url: 'https://x/a' },
      { name: 'B', url: 'https://x/b' },
      { name: 'C', url: 'https://x/c' },
    ],
  });

  assert.equal(sentMessages.length, 1);
  const msg = sentMessages[0];
  assert.match(
    msg.subject ?? '',
    /^\[MegaRadio\]\[[^\]]+\] Blacklisted 3 stations \(bulk deletion\)$/,
  );
  assert.deepEqual(msg.filenames, [`stations-blacklisted-${todayStamp()}.csv`]);
  assert.match(msg.text ?? '', /3 stations were blacklisted via bulk deletion\./);
  assert.match(msg.text ?? '', /Triggered by: \(unknown admin\)/);
});

test('emailBlacklistChangesCsv: action="remove" + 1 row → singular unblacklist copy', async () => {
  const { emailBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  await emailBlacklistChangesCsv({
    action: 'remove',
    source: 'restore',
    rows: [{ name: 'Radio Two', url: 'https://example.com/two.mp3' }],
  });

  assert.equal(sentMessages.length, 1);
  const msg = sentMessages[0];
  assert.match(
    msg.subject ?? '',
    /^\[MegaRadio\]\[[^\]]+\] Unblacklisted 1 station \(restore\)$/,
  );
  assert.deepEqual(msg.filenames, [
    `stations-unblacklisted-${todayStamp()}.csv`,
  ]);
  assert.match(msg.html ?? '', /<h2>Unblacklisted stations<\/h2>/);
  assert.match(msg.text ?? '', /1 station was unblacklisted via restore\./);
});

test('emailBlacklistChangesCsv: action="remove" + many rows → plural unblacklist copy', async () => {
  const { emailBlacklistChangesCsv } = await import(
    '../src/services/admin-audit-email.ts'
  );

  await emailBlacklistChangesCsv({
    action: 'remove',
    source: 'URL-name cleanup',
    rows: [
      { name: 'A', url: 'https://x/a' },
      { name: 'B', url: 'https://x/b' },
    ],
  });

  assert.equal(sentMessages.length, 1);
  const msg = sentMessages[0];
  assert.match(
    msg.subject ?? '',
    /^\[MegaRadio\]\[[^\]]+\] Unblacklisted 2 stations \(URL-name cleanup\)$/,
  );
  assert.deepEqual(msg.filenames, [
    `stations-unblacklisted-${todayStamp()}.csv`,
  ]);
  assert.match(
    msg.text ?? '',
    /2 stations were unblacklisted via URL-name cleanup\./,
  );
});
