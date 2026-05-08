import { logger } from '../lib/logger';

export interface ClearedOverrideRow {
  countryCode: string;
  countryName: string;
  currentLanguageCode: string;
  defaultLanguageCode: string;
}

export interface ResetMappingRow {
  countryCode: string;
  countryName: string;
  languageCode: string;
  isActive: boolean;
  notes: string;
}

export interface FlushStationsCounts {
  deletedStations: number;
  deletedSyncLogs: number;
  deletedBlacklisted: number;
}

function escapeCsv(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

function rowsToCsv(header: string[], body: string[][]): string {
  return [header, ...body]
    .map((cols) => cols.map((c) => escapeCsv(String(c))).join(','))
    .join('\r\n');
}

export function buildClearedOverridesCsv(
  rows: ClearedOverrideRow[],
  languageNames: Record<string, string> = {},
): string {
  const header = ['Country Code', 'Country Name', 'Current Language', 'Fallback Language'];
  const body = rows.map((r) => {
    const currentName = languageNames[r.currentLanguageCode];
    const defaultName = languageNames[r.defaultLanguageCode];
    const current = currentName ? `${currentName} (${r.currentLanguageCode})` : r.currentLanguageCode;
    const fallback = defaultName ? `${defaultName} (${r.defaultLanguageCode})` : r.defaultLanguageCode;
    return [r.countryCode, r.countryName, current, fallback];
  });
  return rowsToCsv(header, body);
}

export interface ClearedOverridesAuditCsvRow {
  createdAt: Date;
  actorEmail: string | null;
  deletedCount: number;
  countryCode: string;
  countryName: string;
  currentLanguageCode: string;
  defaultLanguageCode: string;
}

/**
 * Build a single combined CSV combining many cleared-overrides audit
 * entries into one downloadable file. One CSV row per snapshot entry,
 * plus a leading "createdAt / actor / deletedCount" trio repeating per
 * row so the file is self-contained for spreadsheet pivoting.
 */
export function buildClearedOverridesHistoryCsv(
  rows: ClearedOverridesAuditCsvRow[],
): string {
  const header = [
    'Created At',
    'Actor',
    'Deleted Count',
    'Country Code',
    'Country Name',
    'Current Language',
    'Fallback Language',
  ];
  const body = rows.map((r) => [
    r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    r.actorEmail ?? '',
    String(r.deletedCount),
    r.countryCode,
    r.countryName,
    r.currentLanguageCode,
    r.defaultLanguageCode,
  ]);
  return rowsToCsv(header, body);
}

export function buildResetMappingsCsv(
  rows: ResetMappingRow[],
  languageNames: Record<string, string> = {},
): string {
  const header = ['Country Code', 'Country Name', 'Language', 'Active', 'Notes'];
  const body = rows.map((r) => {
    const langName = languageNames[r.languageCode];
    const lang = langName ? `${langName} (${r.languageCode})` : r.languageCode;
    return [r.countryCode, r.countryName, lang, r.isActive ? 'yes' : 'no', r.notes ?? ''];
  });
  return rowsToCsv(header, body);
}

export interface RemovedStreamSample {
  name: string;
  url: string;
  country?: string;
  countryCode?: string;
}

export interface RemovedStreamsCategoryCount {
  /** Human-readable label, e.g. "M3U", "PLS", "ASX", "Total" */
  label: string;
  count: number;
}

export function buildRemovedStreamsCsv(
  categories: RemovedStreamsCategoryCount[],
  samples: RemovedStreamSample[],
): string {
  const summaryHeader = ['Section', 'Category', 'Removed Count'];
  const summaryBody: string[][] = categories.map((c) => [
    'summary',
    c.label,
    String(c.count),
  ]);

  const sampleHeader = ['Section', 'Name', 'URL', 'Country', 'Country Code'];
  const sampleBody: string[][] = samples.map((s) => [
    'sample',
    s.name ?? '',
    s.url ?? '',
    s.country ?? '',
    s.countryCode ?? '',
  ]);

  const summaryCsv = rowsToCsv(summaryHeader, summaryBody);
  if (sampleBody.length === 0) {
    return summaryCsv;
  }
  const sampleCsv = rowsToCsv(sampleHeader, sampleBody);
  return `${summaryCsv}\r\n\r\n${sampleCsv}`;
}

export function buildFlushStationsCsv(counts: FlushStationsCounts): string {
  const header = ['Collection', 'Deleted Count'];
  const body: string[][] = [
    ['stations', String(counts.deletedStations)],
    ['sync_logs', String(counts.deletedSyncLogs)],
    ['blacklisted_stations', String(counts.deletedBlacklisted)],
  ];
  return rowsToCsv(header, body);
}

function getRecipients(): string[] {
  const raw = process.env.ADMIN_AUDIT_EMAIL_RECIPIENTS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface AdminAuditEmailInput {
  /** Short slug used in the CSV filename, e.g. "country-overrides" */
  filenamePrefix: string;
  /** Subject line summary, e.g. "Cleared 3 country-language overrides" */
  subjectSummary: string;
  /** Title shown in the email body, e.g. "Country-language overrides cleared" */
  title: string;
  /** First descriptive line, e.g. "3 overrides were cleared." */
  summary: string;
  /** CSV body (no BOM; BOM is added before encoding) */
  csv: string;
  /** Number of records the action affected (used only for logging) */
  recordCount: number;
  /** Optional: who triggered it */
  actorEmail?: string;
}

/**
 * Generic admin-audit email sender. Used by every destructive admin bulk
 * action that wants to leave a paper trail. Per-environment opt in/out is
 * controlled by:
 *   ADMIN_AUDIT_EMAIL_RECIPIENTS - comma-separated list (empty => disabled)
 *   ADMIN_AUDIT_EMAIL_FROM       - sender address (defaults to noreply@themegaradio.com)
 *   SENDGRID_API_KEY             - required for delivery
 *
 * Designed to be fire-and-forget: errors are logged but never thrown so the
 * request handler stays unaffected by mail-provider issues.
 */
export async function sendAdminAuditEmail(params: AdminAuditEmailInput): Promise<void> {
  const { filenamePrefix, subjectSummary, title, summary, csv, recordCount, actorEmail } = params;

  const recipients = getRecipients();
  if (recipients.length === 0) {
    logger.info(
      { action: subjectSummary },
      'ADMIN_AUDIT_EMAIL_RECIPIENTS not set - skipping admin audit email',
    );
    return;
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    logger.warn(
      { action: subjectSummary },
      'SENDGRID_API_KEY not set - cannot send admin audit email',
    );
    return;
  }

  try {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const filename = `${filenamePrefix}-${yyyy}-${mm}-${dd}.csv`;
    const csvWithBom = '\ufeff' + csv;
    const base64 = Buffer.from(csvWithBom, 'utf8').toString('base64');

    const sgMail = (await import('@sendgrid/mail')).default;
    sgMail.setApiKey(apiKey);

    const from = process.env.ADMIN_AUDIT_EMAIL_FROM || 'noreply@themegaradio.com';
    const env = process.env.NODE_ENV || 'development';
    const actorLine = actorEmail ? `Triggered by: ${actorEmail}` : 'Triggered by: (unknown admin)';

    await sgMail.send({
      to: recipients,
      from,
      subject: `[MegaRadio][${env}] ${subjectSummary}`,
      text: [
        summary,
        actorLine,
        `Timestamp: ${now.toISOString()}`,
        '',
        'See attached CSV for the full details.',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>${title}</h2>
          <p>${summary}</p>
          <p>${actorLine}<br/>Timestamp: ${now.toISOString()}<br/>Environment: ${env}</p>
          <p>See the attached CSV for the full details.</p>
        </div>
      `,
      attachments: [
        {
          content: base64,
          filename,
          type: 'text/csv',
          disposition: 'attachment',
        },
      ],
    });

    logger.info(
      { recipients: recipients.length, recordCount, action: subjectSummary },
      'Sent admin audit email',
    );
  } catch (err) {
    logger.error(
      { err, action: subjectSummary },
      'Failed to send admin audit email',
    );
  }
}

/**
 * Email a CSV record of cleared country-language overrides. Backwards-compat
 * wrapper around {@link sendAdminAuditEmail}.
 */
export async function emailClearedOverridesCsv(params: {
  rows: ClearedOverrideRow[];
  languageNames?: Record<string, string>;
  actorEmail?: string;
}): Promise<void> {
  const { rows, languageNames = {}, actorEmail } = params;
  if (rows.length === 0) return;

  await sendAdminAuditEmail({
    filenamePrefix: 'country-overrides',
    subjectSummary: `Cleared ${rows.length} country-language override${rows.length === 1 ? '' : 's'}`,
    title: 'Country-language overrides cleared',
    summary: `${rows.length} ${rows.length === 1 ? 'override' : 'overrides'} were cleared.`,
    csv: buildClearedOverridesCsv(rows, languageNames),
    recordCount: rows.length,
    actorEmail,
  });
}

/**
 * Email a CSV snapshot of every country-language mapping wiped by the
 * "Reset all mappings" admin action.
 */
export async function emailResetAllMappingsCsv(params: {
  rows: ResetMappingRow[];
  languageNames?: Record<string, string>;
  actorEmail?: string;
}): Promise<void> {
  const { rows, languageNames = {}, actorEmail } = params;
  if (rows.length === 0) return;

  await sendAdminAuditEmail({
    filenamePrefix: 'country-language-mappings-reset',
    subjectSummary: `Reset all country-language mappings (${rows.length} removed)`,
    title: 'All country-language mappings reset',
    summary: `${rows.length} ${rows.length === 1 ? 'mapping was' : 'mappings were'} removed. All countries will now fall back to defaults.`,
    csv: buildResetMappingsCsv(rows, languageNames),
    recordCount: rows.length,
    actorEmail,
  });
}

/**
 * Email a summary CSV after the "Flush all station data" admin action wipes
 * the stations, sync logs, and blacklisted-station collections.
 */
export async function emailFlushStationsCsv(params: {
  counts: FlushStationsCounts;
  actorEmail?: string;
}): Promise<void> {
  const { counts, actorEmail } = params;
  const total =
    counts.deletedStations + counts.deletedSyncLogs + counts.deletedBlacklisted;
  if (total === 0) return;

  await sendAdminAuditEmail({
    filenamePrefix: 'station-data-flush',
    subjectSummary: `Flushed all station data (${counts.deletedStations} stations)`,
    title: 'Station data flushed',
    summary:
      `Wiped ${counts.deletedStations} stations, ${counts.deletedSyncLogs} sync logs, ` +
      `and ${counts.deletedBlacklisted} blacklisted stations.`,
    csv: buildFlushStationsCsv(counts),
    recordCount: total,
    actorEmail,
  });
}

/**
 * Email a summary CSV after the "Remove playlist files" or "Remove HLS streams"
 * admin actions wipe large batches of station rows. Includes a per-category
 * breakdown plus a sampled list of removed stations (capped to keep the email
 * size sane).
 */
export interface BlacklistChangeRow {
  name: string;
  url: string;
  stationUuid?: string;
  country?: string;
  countryCode?: string;
  reason?: string;
}

export function buildBlacklistChangesCsv(
  action: 'add' | 'remove',
  rows: BlacklistChangeRow[],
): string {
  const header = ['Action', 'Name', 'URL', 'Station UUID', 'Country', 'Country Code', 'Reason'];
  const body: string[][] = rows.map((r) => [
    action === 'add' ? 'blacklisted' : 'unblacklisted',
    r.name ?? '',
    r.url ?? '',
    r.stationUuid ?? '',
    r.country ?? '',
    r.countryCode ?? '',
    r.reason ?? '',
  ]);
  return rowsToCsv(header, body);
}

/**
 * Email a CSV record of stations that were just added to or removed from the
 * blacklist by an admin action (single deletion, bulk deletion, URL-name
 * cleanup, or restore-from-blacklist). Fire-and-forget; respects the
 * ADMIN_AUDIT_EMAIL_RECIPIENTS opt-in.
 */
export async function emailBlacklistChangesCsv(params: {
  action: 'add' | 'remove';
  /** Short label describing the source action, e.g. "single deletion",
   * "bulk deletion", "URL-name cleanup", "restore". Used in the subject. */
  source: string;
  rows: BlacklistChangeRow[];
  actorEmail?: string;
}): Promise<void> {
  const { action, source, rows, actorEmail } = params;
  if (rows.length === 0) return;

  const verb = action === 'add' ? 'Blacklisted' : 'Unblacklisted';
  const noun = action === 'add' ? 'blacklisted' : 'unblacklisted';
  const filenamePrefix = action === 'add' ? 'stations-blacklisted' : 'stations-unblacklisted';

  await sendAdminAuditEmail({
    filenamePrefix,
    subjectSummary: `${verb} ${rows.length} station${rows.length === 1 ? '' : 's'} (${source})`,
    title: `${verb} stations`,
    summary:
      `${rows.length} station${rows.length === 1 ? ' was' : 's were'} ${noun} via ${source}.`,
    csv: buildBlacklistChangesCsv(action, rows),
    recordCount: rows.length,
    actorEmail,
  });
}

// =====================================================================
// Mapping audit digest (Task #211)
// =====================================================================
//
// Daily summary of every country-language mapping action logged in the
// last 24h, grouped by action type with a small sample of per-row diffs
// and snapshot rows. Lets admins keep tabs on overrides without polling
// the audit panel.
// =====================================================================

export type MappingAuditDigestAction =
  | 'clear-overrides'
  | 'reset-all'
  | 'edit'
  | 'delete'
  | 'bulk-save';

export interface MappingAuditDigestChange {
  countryCode: string;
  countryName: string;
  previousLanguageCode: string | null;
  newLanguageCode: string | null;
}

export interface MappingAuditDigestSnapshotEntry {
  countryCode: string;
  countryName: string;
  currentLanguageCode: string;
  defaultLanguageCode: string;
}

export interface MappingAuditDigestEntry {
  createdAt: Date;
  action: MappingAuditDigestAction;
  actorEmail: string | null;
  deletedCount: number;
  changes: MappingAuditDigestChange[];
  snapshot: MappingAuditDigestSnapshotEntry[];
}

export interface MappingAuditDigestActionGroup {
  action: MappingAuditDigestAction;
  count: number;
  rowsAffected: number;
  sampleChange: MappingAuditDigestChange | null;
  sampleSnapshot: MappingAuditDigestSnapshotEntry | null;
  sampleActorEmail: string | null;
  sampleAt: Date | null;
}

const MAPPING_AUDIT_ACTION_LABELS: Record<MappingAuditDigestAction, string> = {
  'clear-overrides': 'Cleared overrides',
  'reset-all': 'Reset all mappings',
  edit: 'Edited mapping',
  delete: 'Deleted mapping',
  'bulk-save': 'Bulk save',
};

/**
 * Group raw audit-log entries from the last window into per-action
 * counts plus a single representative diff/snapshot row, ready to drop
 * into both the digest CSV and the email body.
 */
export function summarizeMappingAuditDigest(
  entries: MappingAuditDigestEntry[],
): MappingAuditDigestActionGroup[] {
  const groups = new Map<MappingAuditDigestAction, MappingAuditDigestActionGroup>();
  for (const e of entries) {
    let g = groups.get(e.action);
    if (!g) {
      g = {
        action: e.action,
        count: 0,
        rowsAffected: 0,
        sampleChange: null,
        sampleSnapshot: null,
        sampleActorEmail: null,
        sampleAt: null,
      };
      groups.set(e.action, g);
    }
    g.count += 1;
    g.rowsAffected +=
      (e.changes?.length ?? 0) +
      (e.snapshot?.length ?? 0) +
      (e.changes?.length || e.snapshot?.length ? 0 : e.deletedCount || 0);
    if (!g.sampleChange && e.changes && e.changes.length > 0) {
      g.sampleChange = e.changes[0];
      g.sampleActorEmail = e.actorEmail;
      g.sampleAt = e.createdAt;
    }
    if (!g.sampleSnapshot && e.snapshot && e.snapshot.length > 0) {
      g.sampleSnapshot = e.snapshot[0];
      if (!g.sampleAt) {
        g.sampleActorEmail = e.actorEmail;
        g.sampleAt = e.createdAt;
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function describeSampleChange(c: MappingAuditDigestChange): string {
  const prev = c.previousLanguageCode ?? '∅';
  const next = c.newLanguageCode ?? '∅';
  return `${c.countryName} (${c.countryCode}): ${prev} → ${next}`;
}

function describeSampleSnapshot(s: MappingAuditDigestSnapshotEntry): string {
  return `${s.countryName} (${s.countryCode}): ${s.currentLanguageCode} → ${s.defaultLanguageCode}`;
}

export function buildMappingAuditDigestCsv(
  groups: MappingAuditDigestActionGroup[],
): string {
  const header = [
    'Action',
    'Entries',
    'Rows Affected',
    'Sample Diff',
    'Sample Snapshot',
    'Sample Actor',
    'Sample Timestamp',
  ];
  const body = groups.map((g) => [
    MAPPING_AUDIT_ACTION_LABELS[g.action] ?? g.action,
    String(g.count),
    String(g.rowsAffected),
    g.sampleChange ? describeSampleChange(g.sampleChange) : '',
    g.sampleSnapshot ? describeSampleSnapshot(g.sampleSnapshot) : '',
    g.sampleActorEmail ?? '',
    g.sampleAt ? g.sampleAt.toISOString() : '',
  ]);
  return rowsToCsv(header, body);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildMappingAuditDigestHtmlTable(
  groups: MappingAuditDigestActionGroup[],
): string {
  const rows = groups
    .map((g) => {
      const label = MAPPING_AUDIT_ACTION_LABELS[g.action] ?? g.action;
      const sample =
        (g.sampleChange ? describeSampleChange(g.sampleChange) : '') ||
        (g.sampleSnapshot ? describeSampleSnapshot(g.sampleSnapshot) : '') ||
        '—';
      return `
        <tr>
          <td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(label)}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${g.count}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;text-align:right;">${g.rowsAffected}</td>
          <td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;">${escapeHtml(sample)}</td>
        </tr>`;
    })
    .join('');
  return `
    <table style="border-collapse:collapse;border:1px solid #ddd;font-size:14px;">
      <thead>
        <tr style="background:#f4f4f4;">
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Action</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:right;">Entries</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:right;">Rows affected</th>
          <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Sample</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Send a daily digest of country-language mapping audit activity.
 * Silently skips if the window is empty so admins don't get noise.
 */
export async function emailMappingAuditDigest(params: {
  entries: MappingAuditDigestEntry[];
  windowStart: Date;
  windowEnd: Date;
}): Promise<{ skipped: boolean; reason?: string; totalEntries: number }> {
  const { entries, windowStart, windowEnd } = params;
  const totalEntries = entries.length;
  if (totalEntries === 0) {
    return { skipped: true, reason: 'no-entries', totalEntries: 0 };
  }

  const groups = summarizeMappingAuditDigest(entries);
  const totalRows = groups.reduce((acc, g) => acc + g.rowsAffected, 0);
  const csv = buildMappingAuditDigestCsv(groups);

  const recipients = getRecipients();
  if (recipients.length === 0) {
    logger.info(
      { totalEntries },
      'ADMIN_AUDIT_EMAIL_RECIPIENTS not set - skipping mapping audit digest email',
    );
    return { skipped: true, reason: 'no-recipients', totalEntries };
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    logger.warn(
      { totalEntries },
      'SENDGRID_API_KEY not set - cannot send mapping audit digest email',
    );
    return { skipped: true, reason: 'no-api-key', totalEntries };
  }

  try {
    const yyyy = windowEnd.getFullYear();
    const mm = String(windowEnd.getMonth() + 1).padStart(2, '0');
    const dd = String(windowEnd.getDate()).padStart(2, '0');
    const filename = `mapping-audit-digest-${yyyy}-${mm}-${dd}.csv`;
    const csvWithBom = '\ufeff' + csv;
    const base64 = Buffer.from(csvWithBom, 'utf8').toString('base64');

    const sgMail = (await import('@sendgrid/mail')).default;
    sgMail.setApiKey(apiKey);

    const from = process.env.ADMIN_AUDIT_EMAIL_FROM || 'noreply@themegaradio.com';
    const env = process.env.NODE_ENV || 'development';
    const subjectSummary =
      `Country-language mapping digest — ${totalEntries} ` +
      `${totalEntries === 1 ? 'change' : 'changes'} in last 24h`;
    const summary =
      `${totalEntries} audit ${totalEntries === 1 ? 'entry' : 'entries'} ` +
      `(${totalRows} ${totalRows === 1 ? 'row' : 'rows'} affected) between ` +
      `${windowStart.toISOString()} and ${windowEnd.toISOString()}.`;

    const textGroups = groups
      .map((g) => {
        const label = MAPPING_AUDIT_ACTION_LABELS[g.action] ?? g.action;
        const sample =
          (g.sampleChange ? describeSampleChange(g.sampleChange) : '') ||
          (g.sampleSnapshot ? describeSampleSnapshot(g.sampleSnapshot) : '') ||
          '—';
        return `  • ${label}: ${g.count} entries, ${g.rowsAffected} rows — sample: ${sample}`;
      })
      .join('\n');

    await sgMail.send({
      to: recipients,
      from,
      subject: `[MegaRadio][${env}] ${subjectSummary}`,
      text: [
        summary,
        '',
        'By action:',
        textGroups,
        '',
        'See attached CSV for the full per-action breakdown with sample diffs.',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Country-language mapping daily digest</h2>
          <p>${escapeHtml(summary)}</p>
          ${buildMappingAuditDigestHtmlTable(groups)}
          <p style="color:#666;font-size:12px;">Environment: ${escapeHtml(env)}</p>
          <p>See attached CSV for the full per-action breakdown.</p>
        </div>
      `,
      attachments: [
        {
          content: base64,
          filename,
          type: 'text/csv',
          disposition: 'attachment',
        },
      ],
    });

    logger.info(
      { recipients: recipients.length, totalEntries, totalRows },
      'Sent mapping audit digest email',
    );
    return { skipped: false, totalEntries };
  } catch (err) {
    logger.error(
      { err, totalEntries },
      'Failed to send mapping audit digest email',
    );
    return { skipped: true, reason: 'send-error', totalEntries };
  }
}

export async function emailRemovedStreamsCsv(params: {
  /** Short slug used in the CSV filename, e.g. "playlist-streams-removed" */
  filenamePrefix: string;
  /** Subject line summary, e.g. "Removed 1234 playlist streams" */
  subjectSummary: string;
  /** Title shown in the email body */
  title: string;
  /** First descriptive line, e.g. "1234 playlist streams were removed." */
  summary: string;
  categories: RemovedStreamsCategoryCount[];
  samples: RemovedStreamSample[];
  totalRemoved: number;
  actorEmail?: string;
}): Promise<void> {
  const { filenamePrefix, subjectSummary, title, summary, categories, samples, totalRemoved, actorEmail } = params;
  if (totalRemoved === 0) return;

  await sendAdminAuditEmail({
    filenamePrefix,
    subjectSummary,
    title,
    summary,
    csv: buildRemovedStreamsCsv(categories, samples),
    recordCount: totalRemoved,
    actorEmail,
  });
}

