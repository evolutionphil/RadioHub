/**
 * SEMrush Site Audit import routes.
 *
 * POST /api/admin/semrush/import   — accepts CSV body (text/csv or multipart field "csv")
 * GET  /api/admin/semrush/issues   — paginated list of imported issues
 * GET  /api/admin/semrush/summary  — issue counts by priority + type
 * DELETE /api/admin/semrush/issues — clear all imported issues
 *
 * CSV format expected: SEMrush Site Audit "Issues" export.
 * Required columns (case-insensitive, order-independent):
 *   URL, Status Code (or Status), Issue (or Issue Type), Description (or Issue Description), Priority
 */

import type { Express, Request, Response } from 'express';
import { SemrushIssue } from '@workspace/db-shared/mongo-schemas';
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

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  // Parse header, handling quoted fields.
  const splitLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    result.push(cur.trim());
    return result;
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length && rows.length < MAX_ROWS_PER_IMPORT; i++) {
    const vals = splitLine(lines[i]);
    if (vals.every((v) => v === '')) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ''; });
    rows.push(row);
  }
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

      if (!csvText || csvText.length < 10) {
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

      // Drop previous import before inserting new one (replace semantics).
      await SemrushIssue.deleteMany({});
      const result = await SemrushIssue.insertMany(docs, { ordered: false });

      logger.log(`SEMrush import: ${result.length} issues (headers: ${detectedHeaders.join(', ')})`);
      res.json({
        message: `Imported ${result.length} issues from SEMrush CSV`,
        count: result.length,
        expiresAt,
        detectedHeaders,
      });
    } catch (err: any) {
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

      const filter: Record<string, unknown> = {};
      if (priority && priority !== 'all') filter.priority = priority;
      if (issueType && issueType !== 'all') filter.issueType = { $regex: issueType, $options: 'i' };

      const [total, items] = await Promise.all([
        SemrushIssue.countDocuments(filter),
        SemrushIssue.find(filter)
          .sort({ priority: 1, importedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);

      res.json({ total, page, limit, items });
    } catch (err: any) {
      logger.error('semrush/issues failed:', err?.message);
      res.status(500).json({ error: 'Failed to fetch issues' });
    }
  });

  // GET /api/admin/semrush/summary
  app.get('/api/admin/semrush/summary', deps.requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [byPriority, byType, total, latest] = await Promise.all([
        SemrushIssue.aggregate([
          { $group: { _id: '$priority', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        SemrushIssue.aggregate([
          { $group: { _id: '$issueType', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),
        SemrushIssue.estimatedDocumentCount(),
        SemrushIssue.findOne().sort({ importedAt: -1 }).select('importedAt expiresAt').lean(),
      ]);

      res.json({
        total,
        byPriority: byPriority.map((r: any) => ({ priority: r._id, count: r.count })),
        topIssueTypes: byType.map((r: any) => ({ type: r._id, count: r.count })),
        lastImportedAt: (latest as any)?.importedAt ?? null,
        expiresAt: (latest as any)?.expiresAt ?? null,
      });
    } catch (err: any) {
      logger.error('semrush/summary failed:', err?.message);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  });

  // DELETE /api/admin/semrush/issues — clear all issues
  app.delete('/api/admin/semrush/issues', deps.requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await SemrushIssue.deleteMany({});
      res.json({ message: `Deleted ${result.deletedCount} SEMrush issues` });
    } catch (err: any) {
      logger.error('semrush/issues DELETE failed:', err?.message);
      res.status(500).json({ error: 'Failed to clear issues' });
    }
  });
}
