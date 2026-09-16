import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { assessLegacyNoindexRecovery, createRecoveryIdentityIndex, recoveryEndpoint, type RecoveryStation } from '../src/seo/legacy-noindex-recovery';
import { LegacyNoindexRecoveryStore } from '../src/data/postgres-legacy-noindex-recovery';

const now = Date.parse('2026-09-17T12:00:00Z');
const station = (patch: Partial<RecoveryStation> = {}): RecoveryStation => ({
  id: 'station-a', name: 'Example Radio', slug: 'example-radio', country: 'Germany', countryCode: 'DE',
  url: 'https://stream.example.invalid/live', urlResolved: null,
  stationuuid: `00000000-0000-4000-8000-${createHash('sha256').update(patch.id || 'station-a').digest('hex').slice(0, 12)}`,
  noIndex: true, redirectToSlug: null, manualEditFields: {}, automaticNoIndex: null,
  lastCheckOk: true, lastCheckTime: new Date(now - 60_000), lastCheckOkTime: new Date(now - 60_000).toISOString(),
  completeLanguageCount: 14, rowVersion: '1000', sourceIsObject: true, journalIsObject: true, ...patch,
});
const owned = { owner: 'radiohub-junk-policy', version: 1, active: true, reason: 'duplicate-of:old-target' };
function assess(row: RecoveryStation, peers: RecoveryStation[] = []) {
  const index = createRecoveryIdentityIndex(); for (const peer of [row, ...peers]) index.add(peer);
  return assessLegacyNoindexRecovery(row, index, now);
}

test('recovery requires provider identity and complete unique content, never just an unknown old flag', () => {
  const row = station(), before = structuredClone(row);
  const result = assess(row);
  assert.equal(result.reason, 'eligible');
  assert.deepEqual(result.candidate?.evidence, { provenance: 'legacy-unknown', providerUuidPresent: true,
    providerLastCheckOk: true, recentProviderSuccess: true, identityPeers: 0, recoveryBasis: 'complete-unique-information-page' });
  assert.equal(assess(station({ automaticNoIndex: owned })).candidate?.evidence.provenance, 'owned-duplicate');
  assert.deepEqual(row, before);
  assert.equal(assess(station({ lastCheckOkTime: null })).reason, 'eligible', 'a recent provider check marked successful is sufficient');
  const cases: Array<[Partial<RecoveryStation>, string]> = [
    [{ noIndex: false }, 'not-noindex'], [{ manualEditFields: { noIndex: true } }, 'manual-protection'],
    [{ manualEditFields: { noIndex: false } }, 'manual-protection'], [{ manualEditFields: { slug: true } }, 'manual-protection'],
    [{ manualEditFields: { redirectToSlug: true } }, 'manual-protection'], [{ manualEditFields: [] }, 'ambiguous-manual-flags'],
    [{ redirectToSlug: 'winner' }, 'redirect'], [{ sourceIsObject: false }, 'ambiguous-metadata'],
    [{ journalIsObject: false }, 'ambiguous-metadata'], [{ automaticNoIndex: {} }, 'other-provenance'],
    [{ automaticNoIndex: { ...owned, owner: 'other' } }, 'other-provenance'],
    [{ automaticNoIndex: { ...owned, reason: 'stream-dead-30d' } }, 'other-provenance'],
    [{ automaticNoIndex: { ...owned, active: false } }, 'other-provenance'],
    [{ slug: '' }, 'missing-slug'], [{ slug: '-123' }, 'numeric-slug'],
    [{ slug: 'example-mp3' }, 'junk:codec-suffix:-mp3'], [{ name: '' }, 'junk:empty-name'],
    [{ stationuuid: 'synthetic-legacy-id' }, 'missing-provider-uuid'],
    [{ stationuuid: '00000000-0000-0000-0000-000000000000' }, 'missing-provider-uuid'],
    [{ country: '' }, 'missing-country-identity'], [{ countryCode: null }, 'missing-country-identity'],
    [{ name: '---' }, 'missing-country-identity'], [{ url: 'ftp://example.invalid/live' }, 'ambiguous-stream-endpoint'],
    [{ url: 'http:example.invalid/live' }, 'ambiguous-stream-endpoint'],
    [{ urlResolved: 'https://user:password@example.invalid' }, 'ambiguous-stream-endpoint'],
    [{ manualEditFields: { lastCheckOk: true } }, 'manual-provider-evidence'],
    [{ manualEditFields: { url: true } }, 'manual-provider-evidence'],
    [{ completeLanguageCount: 13 }, 'incomplete-descriptions'],
  ];
  for (const [patch, expected] of cases) assert.equal(assess(station(patch)).reason, expected, JSON.stringify(patch));
});

test('offline, stale and unknown health qualify only through complete unique content and retain factual evidence', () => {
  const cases: Array<[Partial<RecoveryStation>, boolean | null, string | null]> = [
    [{ lastCheckOk: false, lastCheckOkTime: null }, false, null],
    [{ lastCheckOk: false, lastCheckOkTime: '2026-08-01T00:00:00Z' }, false, '2026-08-01T00:00:00.000Z'],
    [{ lastCheckTime: '2026-08-01T00:00:00Z', lastCheckOkTime: null }, true, '2026-08-01T00:00:00.000Z'],
    [{ lastCheckOk: null, lastCheckTime: null, lastCheckOkTime: null }, null, null],
    [{ lastCheckTime: null, lastCheckOkTime: null }, true, null],
    [{ lastCheckTime: new Date(now + 1), lastCheckOkTime: null }, true, null],
    [{ lastCheckOkTime: 'invalid' }, true, null], [{ lastCheckOkTime: {} }, true, null],
  ];
  for (const [patch, actualHealth, successfulDate] of cases) {
    const row = station(patch), before = structuredClone(row), result = assess(row);
    assert.equal(result.reason, 'eligible');
    assert.equal(result.candidate?.evidence.providerLastCheckOk, actualHealth);
    assert.equal(result.candidate?.evidence.recentProviderSuccess, false);
    assert.equal(result.candidate?.evidence.recoveryBasis, 'complete-unique-information-page');
    assert.equal(result.candidate?.lastCheckOkTime, successfulDate);
    assert.deepEqual(row, before, 'classification never changes health or metadata');
    assert.equal(assess(station({ ...patch, completeLanguageCount: 13 })).reason, 'incomplete-descriptions');
    assert.equal(assess(station({ ...patch, manualEditFields: { noIndex: true } })).reason, 'manual-protection');
    assert.equal(assess(row, [station({ id: 'peer', slug: 'different-slug' })]).reason, 'plausible-identity-peer');
  }
});

test('whole-catalog identity peers include indexed rows, redirects, punctuation variants and missing-country ambiguity', () => {
  const row = station();
  const peer = (patch: Partial<RecoveryStation> = {}) => station({ id: 'peer', slug: 'unique-peer-slug', noIndex: false,
    url: 'https://other.example.invalid/live', lastCheckOk: false, ...patch });
  for (const other of [peer(), peer({ name: 'Éxample-RADIO' }), peer({ country: '', countryCode: null }),
    peer({ country: 'Deutschland', countryCode: null }), peer({ redirectToSlug: 'elsewhere' }),
    peer({ name: 'Different brand', country: 'France', countryCode: 'FR', urlResolved: row.url }),
    peer({ name: 'Other brand', country: 'France', countryCode: 'FR', url: row.url + '#player' }),
    peer({ name: 'Other brand', country: 'France', countryCode: 'FR', slug: row.slug })]) {
    assert.equal(assess(row, [other]).reason, 'plausible-identity-peer');
  }
  assert.equal(assess(row, [peer({ country: 'France', countryCode: 'FR' })]).reason, 'eligible');
  assert.equal(assess(station({ automaticNoIndex: owned }), [peer({ name: 'Renamed station', slug: 'old-target' })]).reason, 'plausible-identity-peer');
  for (const other of [peer({ name: 'Other Brand', slug: 'example-radio-2' }),
    peer({ name: 'Other Brand', slug: '1024-example-radio' }),
    peer({ name: 'Other Brand', slug: 'example-radio-mp3' }),
    peer({ name: 'Other Brand', slugAliases: ['example-radio'] }),
    peer({ name: 'Other Brand', stationuuid: row.stationuuid.toUpperCase() })]) assert.equal(assess(row, [other]).reason, 'plausible-identity-peer');
});

test('stream identity retains actual path/query/protocol, rejects credentials and normalizes URL syntax', () => {
  assert.equal(recoveryEndpoint('HTTPS://STREAM.EXAMPLE.INVALID:443/live#part'), 'https://stream.example.invalid/live');
  assert.notEqual(recoveryEndpoint('http://stream.example.invalid/live'), recoveryEndpoint('https://stream.example.invalid/live'));
  assert.notEqual(recoveryEndpoint('https://stream.example.invalid/Live?a=1'), recoveryEndpoint('https://stream.example.invalid/live?a=1'));
  assert.notEqual(recoveryEndpoint('https://stream.example.invalid/live?a=1'), recoveryEndpoint('https://stream.example.invalid/live?a=2'));
  for (const input of ['', 'http:stream.example.invalid', 'ftp://stream.example.invalid', 'https://user:secret@stream.example.invalid']) assert.equal(recoveryEndpoint(input), null);
});

function fixture(initial = [station()], invalidate: (slugs: string[]) => Promise<boolean> = async () => true) {
  let rows = initial, identitiesFetched = false, candidatesFetched = false;
  const queries: string[] = [], values: any[][] = [], clients: any[] = [];
  let lockFailure = false, simulatedError = false, commitAckError = false;
  const pool = { connect: async () => {
    const client = Object.assign(new EventEmitter(), {
      released: false, discarded: false, wrote: false,
      release(discard: boolean) { this.released = true; this.discarded = discard; },
      async query(input: any, params?: any[]) {
        const sql = typeof input === 'string' ? input : input.text;
        const parameters = params || input.values || [];
        queries.push(sql); values.push(parameters);
        if (sql.startsWith('LOCK TABLE') && lockFailure) throw Object.assign(new Error('busy'), { code: '55P03' });
        if (sql.includes('pg_try_advisory')) return { rows: [{ acquired: true }] };
        if (sql.includes('transaction_timestamp() AS at')) return { rows: [{ at: new Date(now) }] };
        if (sql.startsWith('DECLARE noindex_recovery_identity')) { identitiesFetched = false; return { rows: [] }; }
        if (sql.startsWith('DECLARE noindex_recovery_candidates')) { candidatesFetched = false; return { rows: [] }; }
        if (sql.startsWith('FETCH') && sql.includes('noindex_recovery_identity')) {
          if (simulatedError) { client.emit('error', new Error('connection died')); return { rows: [] }; }
          if (identitiesFetched) return { rows: [] }; identitiesFetched = true; return { rows: structuredClone(rows) };
        }
        if (sql.startsWith('FETCH') && sql.includes('noindex_recovery_candidates')) {
          if (candidatesFetched) return { rows: [] }; candidatesFetched = true; return { rows: structuredClone(rows.filter(row => row.noIndex)) };
        }
        if (sql.startsWith('SELECT') && sql.includes('FROM stations s WHERE')) return { rows: structuredClone(rows.filter(row => parameters[0].includes(row.id))) };
        if (sql.startsWith('SELECT') && sql.includes('FROM stations s')) return { rows: structuredClone(rows) };
        if (sql.startsWith('UPDATE stations')) { client.wrote = true; return { rows: rows.filter(row => parameters[0].includes(row.id)).map(row => ({ id: row.id })) }; }
        if (sql === 'COMMIT') {
          if (client.wrote && commitAckError) client.emit('error', new Error('Socket ended alongside COMMIT acknowledgement'));
          return { rows: [], command: 'COMMIT' };
        }
        return { rows: [] };
      },
    });
    clients.push(client); return client as any;
  } };
  return { store: new LegacyNoindexRecoveryStore(() => pool as any, invalidate), queries, values, clients,
    failAlongsideCommitAck: () => { commitAckError = true; },
    setRows: (next: RecoveryStation[]) => { rows = next; }, busy: () => { lockFailure = true; }, failConnection: () => { simulatedError = true; } };
}

test('preview is read only, full catalog reconciles with disjoint noindex reasons and response omits private stream URLs', async () => {
  const f = fixture([station(), station({ id: 'indexed', name: 'Other Station', slug: 'other-station', url: 'https://other.invalid', noIndex: false }),
    station({ id: 'manual', manualEditFields: { noIndex: true } })]);
  const report = await f.store.preview();
  assert.equal(report.totalScanned, 3); assert.equal(report.totalNoIndex, 2);
  assert.equal(report.totalCandidates, 0, 'a manual duplicate peer blocks the otherwise plausible candidate');
  assert.deepEqual(report.reasonCounts, { 'plausible-identity-peer': 1, 'manual-protection': 1 });
  assert.ok(f.queries[0].includes('READ ONLY'));
  assert.ok(f.queries.every(sql => !sql.startsWith('UPDATE') && !sql.startsWith('LOCK TABLE')));
  assert.doesNotMatch(JSON.stringify(report), /stream\.example|urlResolved|rowVersion|automaticNoIndex/);
  assert.ok(f.queries.some(sql => sql.includes('s.xmin::text')));
  assert.ok(f.queries.every(sql => !/SELECT\s+\*|SELECT s\.source\b/.test(sql)));
  assert.equal(f.clients[0].released, true);
});

test('explicit apply locks before rereading all peers, rechecks selected evidence, journals before state and is single use', async () => {
  const f = fixture(); const preview = await f.store.preview();
  assert.equal(preview.totalCandidates, 1);
  const offset = f.queries.length;
  const result = await f.store.apply({ previewId: preview.previewId, stationIds: ['station-a'], actor: 'admin-a' });
  assert.deepEqual(result, { restored: 1, restoredIds: ['station-a'], skipped: 0, skippedReasons: [], cacheInvalidated: true });
  const queries = f.queries.slice(offset);
  const lock = queries.findIndex(sql => sql.startsWith('LOCK TABLE'));
  const selected = queries.findIndex(sql => sql.includes('FOR UPDATE'));
  const identity = queries.findIndex(sql => sql.startsWith('SELECT') && sql.includes('FROM stations s') && !sql.includes('WHERE'));
  const update = queries.findIndex(sql => sql.startsWith('UPDATE stations'));
  assert.ok(lock >= 0 && selected > lock && identity > selected && update > identity);
  assert.match(queries[lock], /SHARE ROW EXCLUSIVE MODE NOWAIT/);
  assert.match(queries[update], /no_index_recovery_journal=/); assert.match(queries[update], /sourceNoIndexPresent/);
  assert.doesNotMatch(queries[update], /noIndexRecoveryJournal/);
  assert.match(queries[update], /'automaticNoIndex',s.source->'automaticNoIndex'/);
  assert.doesNotMatch(queries[update], /(?:descriptions|name|slug|url|redirect_to_slug)\s*=/);
  assert.equal(queries.at(-1), 'COMMIT');
  await assert.rejects(f.store.apply({ previewId: preview.previewId, stationIds: ['station-a'] }), { code: 'RECOVERY_STALE' });
});

test('stale flags, metadata/content version, deleted row and newly inserted indexed identity peer fail the whole batch closed', async () => {
  for (const next of [
    [station({ manualEditFields: { noIndex: true } })], [station({ rowVersion: '1001' })], [],
    [station(), station({ id: 'new-peer', noIndex: false, slug: 'new-distinct-slug' })],
    [station({ lastCheckOk: false })], [station({ completeLanguageCount: 13 })],
  ]) {
    const f = fixture(); const preview = await f.store.preview(); f.setRows(next);
    await assert.rejects(f.store.apply({ previewId: preview.previewId, stationIds: ['station-a'] }), { code: 'RECOVERY_STALE' });
    assert.equal(f.queries.at(-1), 'ROLLBACK'); assert.ok(!f.queries.some(sql => sql.startsWith('UPDATE')));
  }
});

test('unreviewed IDs, empty/duplicate/oversize selections are rejected before obtaining any write connection', async () => {
  const f = fixture(), preview = await f.store.preview();
  for (const stationIds of [[], ['absent'], ['station-a', 'station-a'], Array.from({ length: 101 }, (_, i) => String(i))]) {
    await assert.rejects(f.store.apply({ previewId: preview.previewId, stationIds }), { code: 'RECOVERY_INVALID' });
  }
  assert.equal(f.clients.length, 1);
  assert.equal((await f.store.apply({ previewId: preview.previewId, stationIds: ['station-a'] })).restored, 1);
});

test('busy writers and connection errors fail safely and always release checked-out clients', async () => {
  const f = fixture(); const preview = await f.store.preview(); f.busy();
  await assert.rejects(f.store.apply({ previewId: preview.previewId, stationIds: ['station-a'] }), { code: 'RECOVERY_BUSY' });
  assert.equal(f.queries.at(-1), 'ROLLBACK'); assert.ok(f.clients.every(client => client.released));
  assert.ok(!f.queries.some(sql => sql.startsWith('UPDATE')));
  const broken = fixture(); broken.failConnection();
  await assert.rejects(broken.store.preview(), { code: 'RECOVERY_UNAVAILABLE' });
  assert.equal(broken.clients[0].discarded, true);
});

test('candidate cap bounds server snapshots and only returned candidates can be selected', async () => {
  const rows = Array.from({ length: 105 }, (_, i) => station({ id: `s-${i}`, name: `Brand ${i}`, slug: `brand${i}`, url: `https://stream${i}.example.invalid` }));
  const f = fixture(rows), report = await f.store.preview();
  assert.equal(report.totalCandidates, 105); assert.equal(report.candidates.length, 100);
  await assert.rejects(f.store.apply({ previewId: report.previewId, stationIds: ['s-104'] }), { code: 'RECOVERY_INVALID' });
});

test('an acknowledged COMMIT stays successful when the socket emits an error alongside its result', async () => {
  const f = fixture(), preview = await f.store.preview(); f.failAlongsideCommitAck();
  const result = await f.store.apply({ previewId: preview.previewId, stationIds: ['station-a'] });
  assert.equal(result.restored, 1); assert.equal(f.queries.at(-1), 'COMMIT');
  assert.equal(f.clients.at(-1).discarded, true);
  assert.equal(f.queries.filter(sql => sql.startsWith('UPDATE stations')).length, 1);
  assert.equal(f.queries.some(sql => sql.includes("->>'action'")), false, 'acknowledgement needs no receipt recheck');
});

test('postcommit cache rejection or a stuck cache never loses the successful mutation response', async () => {
  for (const invalidate of [() => { throw new Error('Synchronous cache failure'); },
    async () => { throw new Error('Redis unavailable'); }, () => new Promise<boolean>(() => {})]) {
    const f = fixture([station()], invalidate), preview = await f.store.preview();
    const startedAt = Date.now();
    const result = await f.store.apply({ previewId: preview.previewId, stationIds: ['station-a'] });
    assert.equal(result.restored, 1); assert.equal(result.cacheInvalidated, false);
    assert.ok(Date.now() - startedAt < 2000, 'cache response wait is bounded independently of database safety deadline');
    assert.equal(f.queries.at(-1), 'COMMIT'); assert.ok(f.clients.every(client => client.released));
  }
});
