import { logger } from '../lib/logger';

export interface ClearedOverrideRow {
  countryCode: string;
  countryName: string;
  currentLanguageCode: string;
  defaultLanguageCode: string;
}

function escapeCsv(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
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
  return [header, ...body]
    .map((cols) => cols.map((c) => escapeCsv(String(c))).join(','))
    .join('\r\n');
}

function getRecipients(): string[] {
  const raw = process.env.ADMIN_AUDIT_EMAIL_RECIPIENTS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Email a CSV record of cleared country-language overrides to a configured
 * admin recipient list. Per-environment opt in/out is controlled by:
 *   ADMIN_AUDIT_EMAIL_RECIPIENTS - comma-separated list (empty => disabled)
 *   ADMIN_AUDIT_EMAIL_FROM       - sender address (defaults to noreply@themegaradio.com)
 *   SENDGRID_API_KEY             - required for delivery
 *
 * Designed to be fire-and-forget: errors are logged but never thrown so the
 * request handler stays unaffected by mail-provider issues.
 */
export async function emailClearedOverridesCsv(params: {
  rows: ClearedOverrideRow[];
  languageNames?: Record<string, string>;
  actorEmail?: string;
}): Promise<void> {
  const { rows, languageNames = {}, actorEmail } = params;
  if (rows.length === 0) return;

  const recipients = getRecipients();
  if (recipients.length === 0) {
    logger.info(
      'ADMIN_AUDIT_EMAIL_RECIPIENTS not set - skipping cleared-overrides audit email',
    );
    return;
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    logger.warn(
      'SENDGRID_API_KEY not set - cannot send cleared-overrides audit email',
    );
    return;
  }

  try {
    const csv = buildClearedOverridesCsv(rows, languageNames);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const filename = `country-overrides-${yyyy}-${mm}-${dd}.csv`;
    const csvWithBom = '\ufeff' + csv;
    const base64 = Buffer.from(csvWithBom, 'utf8').toString('base64');

    const sgMail = (await import('@sendgrid/mail')).default;
    sgMail.setApiKey(apiKey);

    const from = process.env.ADMIN_AUDIT_EMAIL_FROM || 'noreply@themegaradio.com';
    const env = process.env.NODE_ENV || 'development';
    const actorLine = actorEmail ? `Cleared by: ${actorEmail}` : 'Cleared by: (unknown admin)';
    const summary = `${rows.length} ${rows.length === 1 ? 'override' : 'overrides'} were cleared.`;

    await sgMail.send({
      to: recipients,
      from,
      subject: `[MegaRadio][${env}] Cleared ${rows.length} country-language override${rows.length === 1 ? '' : 's'}`,
      text: [
        summary,
        actorLine,
        `Timestamp: ${now.toISOString()}`,
        '',
        'See attached CSV for the full list of removed overrides.',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Country-language overrides cleared</h2>
          <p>${summary}</p>
          <p>${actorLine}<br/>Timestamp: ${now.toISOString()}<br/>Environment: ${env}</p>
          <p>See the attached CSV for the full list of removed overrides.</p>
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
      { recipients: recipients.length, deletedCount: rows.length },
      'Sent cleared-overrides audit email',
    );
  } catch (err) {
    logger.error(
      { err },
      'Failed to send cleared-overrides audit email',
    );
  }
}
