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

