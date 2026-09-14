/**
 * SEMrush Site Audit import routes.
 *
 * POST /api/admin/semrush/import   — accepts CSV body (text/csv or JSON field "csv")
 * GET  /api/admin/semrush/issues   — paginated list of imported issues
 * GET  /api/admin/semrush/summary  — issue counts by priority + type
 * DELETE /api/admin/semrush/issues — clear all imported issues
 *
 * CSV format expected: SEMrush Site Audit "Issues" export.
 * Required columns (case-insensitive, order-independent):
 *   URL, Status Code (or Status), Issue (or Issue Type), Description (or Issue Description), Priority
 */

import type { Express, Request, Response } from 'express';
import { pgAdminAux } from '../data/postgres-admin-auxiliary-store';
import { logger } from '../utils/logger';

const TTL_DAYS = 30;
const MAX_ROWS_PER_IMPORT = 50_000;

function parsePriority(raw: string): 'High' | 'Medium' | 'Low' | 'Info' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'high' || v === 'error' || v === 'errors' || v === 'critical') return 'High';
  if (v === 'medium' || v === 'warning' || v === 'warnings') return 'Medium';
  if (v === 'low' || v === 'notice' || v === 'notices' || v === 'info') return 'Low';
  return 'Info';
}

class SemrushCsvError extends Error {}

function parseCsv(text: string): Array<Record<string, string>> {
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '');
  // Regional exports can use semicolons or tabs. Only count separators outside
  // quoted header cells so commas inside a column label do not select a format.
  const separators = new Map([[',', 0], [';', 0], ['\t', 0]]);
  let quotedHeader = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quotedHeader && input[i + 1] === '"') { i++; continue; }
      quotedHeader = !quotedHeader;
    } else if (!quotedHeader) {
      if (ch === '\n') break;
      if (separators.has(ch)) separators.set(ch, separators.get(ch)! + 1);
    }
  }
  const delimiter = [...separators].sort((a, b) => b[1] - a[1])[0][0];
  let headers: string[] | undefined;
  const rows: Array<Record<string, string>> = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const finishCell = () => {
    cells.push(cell.trim());
    cell = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (cells.some(value => value !== '')) {
      if (!headers) {
        headers = cells.map(value => value.toLowerCase().replace(/[^a-z0-9]/g, '_'));
        if (headers.some(value => !value) || new Set(headers).size !== headers.length) {
          throw new SemrushCsvError('CSV column names must be non-empty and unique');
        }
      } else {
        if (cells.length !== headers.length) throw new SemrushCsvError(`CSV row ${rows.length + 2} has ${cells.length} columns; expected ${headers.length}`);
        if (rows.length >= MAX_ROWS_PER_IMPORT) throw new SemrushCsvError(`CSV exceeds the ${MAX_ROWS_PER_IMPORT.toLocaleString('en-US')}-row import limit`);
        rows.push(Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
      }
    }
    cells = [];
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (input[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closedQuote = true; }
    } else if (ch === delimiter) finishCell();
    else if (ch === '\n') finishRow();
    else if (closedQuote) {
      if (!/\s/.test(ch)) throw new SemrushCsvError('Unexpected text after a closing CSV quote');
    } else if (ch === '"') {
      if (cell.trim()) throw new SemrushCsvError('Unexpected quote in an unquoted CSV field');
      cell = '';
      quoted = true;
    } else cell += ch;
  }
  if (quoted) throw new SemrushCsvError('CSV contains an unterminated quoted field');
  finishRow();
  return rows;
}

function extractField(row: Record<string, string>, ...candidates: string[]): string {
  for (const c of candidates) {
    const v = row[c.toLowerCase().replace(/[^a-z0-9]/g, '_')];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

export function registerSemrushAdminRoutes(app: Express, deps: any) {
  // POST /api/admin/semrush/import
  // Body: raw CSV text (Content-Type: text/csv) OR JSON { csv: "<string>" }
  app.post('/api/admin/semrush/import', deps.requireAdmin, async (req: Request, res: Response) => {
    try {
      let csvText = '';
      const ct = req.headers['content-type'] ?? '';
      if (ct.includes('text/csv') || ct.includes('text/plain')) {
        // Raw body — requires express.text() middleware (registered below).
        csvText = req.body as string;
      } else if (typeof req.body?.csv === 'string') {
        csvText = req.body.csv;
      } else {
        return void res.status(400).json({ error: 'Provide CSV as text/csv body or JSON { csv: "..." }' });
      }

      if (typeof csvText !== 'string' || csvText.length < 10) {
        return void res.status(400).json({ error: 'CSV body is empty or too short' });
      }

      const rows = parseCsv(csvText);
      if (rows.length === 0) {
        return void res.status(400).json({ error: 'No data rows found in CSV' });
      }

      // Return the detected headers so callers can diagnose column mapping.
      const detectedHeaders = rows[0] ? Object.keys(rows[0]) : [];

      const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
      const docs = rows.map((row) => ({
        // URL: standard + SEMrush "Page" column name
        url: extractField(row, 'url', 'page', 'page_url', 'address', 'link'),
        // Status code: SEMrush uses "Status Code" → status_code
        statusCode: parseInt(extractField(row, 'status_code', 'status', 'http_status', 'response_code') || '0', 10) || 0,
        // Issue type: SEMrush "Issue name" → issue_name, or "Check name", "Category" (for aggregated), "Error type" → error_type
        issueType: extractField(row, 'issue_name', 'check_name', 'issue', 'issue_type', 'name', 'error_type', 'type', 'category') || 'Unknown',
        // Description: SEMrush "Description" or "Details"
        issueDescription: extractField(row, 'description', 'issue_description', 'details', 'about') || '',
        // Priority: SEMrush "Severity" or "Category" (Errors/Warnings/Notices) or "Priority"
        priority: parsePriority(extractField(row, 'severity', 'category', 'priority', 'level', 'type')),
        importedAt: new Date(),
        expiresAt,
      }));

      const imported = await pgAdminAux().replaceIssues(docs);
      const result = { length:imported };

      logger.log(`SEMrush import: ${result.length} issues (headers: ${detectedHeaders.join(', ')})`);
      res.json({
        message: `Imported ${result.length} issues from SEMrush CSV`,
        count: result.length,
        expiresAt,
        detectedHeaders,
      });
    } catch (err: any) {
      if (err instanceof SemrushCsvError) {
        return void res.status(400).json({ error: err.message });
      }
      logger.error('semrush/import failed:', err?.message);
      res.status(500).json({ error: 'Import failed: ' + (err?.message ?? 'unknown') });
    }
  });

  // GET /api/admin/semrush/issues
  app.get('/api/admin/semrush/issues', deps.requireAdmin, async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
      const priority = String(req.query.priority ?? '');
      const issueType = String(req.query.issueType ?? '');

      const { total,items } = await pgAdminAux().issues(priority,issueType,limit,(page-1)*limit);

      res.json({ total, page, limit, items });
    } catch (err: any) {
      logger.error('semrush/issues failed:', err?.message);
      res.status(500).json({ error: 'Failed to fetch issues' });
    }
  });

  // GET /api/admin/semrush/summary
  app.get('/api/admin/semrush/summary', deps.requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await pgAdminAux().issueSummary());
    } catch (err: any) {
      logger.error('semrush/summary failed:', err?.message);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  });

  // DELETE /api/admin/semrush/issues — clear all issues
  app.delete('/api/admin/semrush/issues', deps.requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await pgAdminAux().clearIssues();
      res.json({ message: `Deleted ${result.deletedCount} SEMrush issues` });
    } catch (err: any) {
      logger.error('semrush/issues DELETE failed:', err?.message);
      res.status(500).json({ error: 'Failed to clear issues' });
    }
  });
}
