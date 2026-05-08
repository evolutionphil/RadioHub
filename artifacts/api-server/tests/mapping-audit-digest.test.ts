/**
 * Unit tests for the daily country-language mapping audit digest helpers in
 * `src/services/admin-audit-email.ts` (Task #211).
 *
 * Covers the pure data-in / data-out helpers that build the email body
 * + CSV attachment, plus the empty-window skip path of the top-level
 * `emailMappingAuditDigest` so future refactors can't silently break the
 * digest format.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMappingAuditDigestCsv,
  emailMappingAuditDigest,
  summarizeMappingAuditDigest,
  type MappingAuditDigestEntry,
} from '../src/services/admin-audit-email.ts';

function entry(
  partial: Partial<MappingAuditDigestEntry> &
    Pick<MappingAuditDigestEntry, 'action'>,
): MappingAuditDigestEntry {
  return {
    createdAt: new Date('2026-05-01T12:00:00.000Z'),
    actorEmail: null,
    deletedCount: 0,
    changes: [],
    snapshot: [],
    ...partial,
  };
}

describe('summarizeMappingAuditDigest', () => {
  it('returns an empty list for no entries', () => {
    assert.deepEqual(summarizeMappingAuditDigest([]), []);
  });

  it('groups entries by action and sorts by descending count', () => {
    const entries: MappingAuditDigestEntry[] = [
      entry({
        action: 'edit',
        actorEmail: 'a@example.com',
        changes: [
          {
            countryCode: 'US',
            countryName: 'United States',
            previousLanguageCode: 'en',
            newLanguageCode: 'es',
          },
        ],
      }),
      entry({
        action: 'edit',
        actorEmail: 'b@example.com',
        changes: [
          {
            countryCode: 'FR',
            countryName: 'France',
            previousLanguageCode: 'fr',
            newLanguageCode: 'en',
          },
        ],
      }),
      entry({
        action: 'delete',
        actorEmail: 'c@example.com',
        deletedCount: 4,
      }),
    ];

    const groups = summarizeMappingAuditDigest(entries);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].action, 'edit');
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].rowsAffected, 2);
    assert.equal(groups[1].action, 'delete');
    assert.equal(groups[1].count, 1);
    // No changes/snapshot rows so falls back to deletedCount for "rows affected".
    assert.equal(groups[1].rowsAffected, 4);
  });

  it('captures the first change as the sample diff with its actor + timestamp', () => {
    const firstAt = new Date('2026-05-01T08:00:00.000Z');
    const secondAt = new Date('2026-05-01T09:00:00.000Z');
    const groups = summarizeMappingAuditDigest([
      entry({
        action: 'edit',
        createdAt: firstAt,
        actorEmail: 'first@example.com',
        changes: [
          {
            countryCode: 'DE',
            countryName: 'Germany',
            previousLanguageCode: 'de',
            newLanguageCode: 'en',
          },
        ],
      }),
      entry({
        action: 'edit',
        createdAt: secondAt,
        actorEmail: 'second@example.com',
        changes: [
          {
            countryCode: 'IT',
            countryName: 'Italy',
            previousLanguageCode: 'it',
            newLanguageCode: 'en',
          },
        ],
      }),
    ]);

    assert.equal(groups.length, 1);
    const g = groups[0];
    assert.deepEqual(g.sampleChange, {
      countryCode: 'DE',
      countryName: 'Germany',
      previousLanguageCode: 'de',
      newLanguageCode: 'en',
    });
    assert.equal(g.sampleActorEmail, 'first@example.com');
    assert.equal(g.sampleAt?.toISOString(), firstAt.toISOString());
  });

  it('falls back to the first snapshot when no changes are present', () => {
    const at = new Date('2026-05-02T10:00:00.000Z');
    const groups = summarizeMappingAuditDigest([
      entry({
        action: 'clear-overrides',
        createdAt: at,
        actorEmail: 'snap@example.com',
        snapshot: [
          {
            countryCode: 'BR',
            countryName: 'Brazil',
            currentLanguageCode: 'pt',
            defaultLanguageCode: 'en',
          },
          {
            countryCode: 'AR',
            countryName: 'Argentina',
            currentLanguageCode: 'es',
            defaultLanguageCode: 'en',
          },
        ],
      }),
    ]);

    assert.equal(groups.length, 1);
    const g = groups[0];
    assert.equal(g.sampleChange, null);
    assert.deepEqual(g.sampleSnapshot, {
      countryCode: 'BR',
      countryName: 'Brazil',
      currentLanguageCode: 'pt',
      defaultLanguageCode: 'en',
    });
    assert.equal(g.sampleActorEmail, 'snap@example.com');
    assert.equal(g.sampleAt?.toISOString(), at.toISOString());
    assert.equal(g.rowsAffected, 2);
  });
});

describe('buildMappingAuditDigestCsv', () => {
  it('emits just the header for an empty group list', () => {
    const csv = buildMappingAuditDigestCsv([]);
    assert.equal(
      csv,
      'Action,Entries,Rows Affected,Sample Diff,Sample Snapshot,Sample Actor,Sample Timestamp',
    );
  });

  it('renders one row per group with action label, sample diff, and snapshot', () => {
    const groups = summarizeMappingAuditDigest([
      entry({
        action: 'edit',
        createdAt: new Date('2026-05-03T11:22:33.000Z'),
        actorEmail: 'editor@example.com',
        changes: [
          {
            countryCode: 'US',
            countryName: 'United States',
            previousLanguageCode: 'en',
            newLanguageCode: 'es',
          },
        ],
      }),
      entry({
        action: 'clear-overrides',
        createdAt: new Date('2026-05-03T11:00:00.000Z'),
        actorEmail: 'clearer@example.com',
        snapshot: [
          {
            countryCode: 'JP',
            countryName: 'Japan',
            currentLanguageCode: 'ja',
            defaultLanguageCode: 'en',
          },
        ],
      }),
    ]);

    const csv = buildMappingAuditDigestCsv(groups);
    const lines = csv.split('\r\n');

    assert.equal(lines.length, 3);
    assert.equal(
      lines[0],
      'Action,Entries,Rows Affected,Sample Diff,Sample Snapshot,Sample Actor,Sample Timestamp',
    );

    const editLine = lines.find((l) => l.startsWith('Edited mapping,'));
    assert.ok(editLine, 'expected an "Edited mapping" row');
    assert.ok(
      editLine!.includes('United States (US): en → es'),
      `edit row should contain the sample diff, got: ${editLine}`,
    );
    assert.ok(
      editLine!.includes('editor@example.com'),
      'edit row should include the sample actor email',
    );
    assert.ok(
      editLine!.includes('2026-05-03T11:22:33.000Z'),
      'edit row should include the ISO sample timestamp',
    );

    const clearLine = lines.find((l) => l.startsWith('Cleared overrides,'));
    assert.ok(clearLine, 'expected a "Cleared overrides" row');
    assert.ok(
      clearLine!.includes('Japan (JP): ja → en'),
      `clear-overrides row should contain the sample snapshot, got: ${clearLine}`,
    );
  });

  it('quotes fields that contain commas so the CSV stays parseable', () => {
    const groups = summarizeMappingAuditDigest([
      entry({
        action: 'edit',
        actorEmail: 'comma@example.com',
        changes: [
          {
            countryCode: 'CD',
            countryName: 'Congo, Democratic Republic',
            previousLanguageCode: 'fr',
            newLanguageCode: 'en',
          },
        ],
      }),
    ]);

    const csv = buildMappingAuditDigestCsv(groups);
    assert.ok(
      csv.includes('"Congo, Democratic Republic (CD): fr → en"'),
      `expected the comma-bearing sample diff to be quoted, got: ${csv}`,
    );
  });
});

describe('emailMappingAuditDigest', () => {
  it('skips silently when the window has no entries', async () => {
    const result = await emailMappingAuditDigest({
      entries: [],
      windowStart: new Date('2026-05-04T00:00:00.000Z'),
      windowEnd: new Date('2026-05-05T00:00:00.000Z'),
    });

    assert.deepEqual(result, {
      skipped: true,
      reason: 'no-entries',
      totalEntries: 0,
    });
  });
});
