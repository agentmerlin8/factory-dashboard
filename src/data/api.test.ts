// DSH-2 api tests — fetch + parse into {rows} | {error}, never throw.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFindings, fetchLedger, fetchRuns } from './api';
import { findings } from './fixtures';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRuns', () => {
  it('parses the run-id list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(['demo-run', 'control-run'])));
    expect(await fetchRuns()).toEqual({ rows: ['demo-run', 'control-run'] });
  });

  it('surfaces a per-source {error} response as a typed error, no throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: 'runs: [Errno 13] Permission denied' })));
    expect(await fetchRuns()).toEqual({ error: 'runs: [Errno 13] Permission denied' });
  });

  it('rejects a non-array payload as a typed error, never fabricated rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ nope: true })));
    const res = await fetchRuns();
    expect(res).toHaveProperty('error');
    expect(res).not.toHaveProperty('rows');
  });
});

describe('fetchLedger', () => {
  it('requests the run and parses rows', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ event: 'run_started', schema: 0 }]));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchLedger('demo-run');
    expect(fetchMock).toHaveBeenCalledWith('/api/ledger?run=demo-run');
    expect(res).toEqual({ rows: [{ event: 'run_started', schema: 0 }] });
  });

  it('encodes the run id in the query string', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await fetchLedger('a b&c');
    expect(fetchMock).toHaveBeenCalledWith('/api/ledger?run=a%20b%26c');
  });

  it('surfaces a per-source {error} response as a typed error, no throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: 'runs/demo-run/ledger.jsonl: invalid JSON at line 3' })));
    expect(await fetchLedger('demo-run')).toEqual({
      error: 'runs/demo-run/ledger.jsonl: invalid JSON at line 3',
    });
  });

  it('turns a network failure into a typed error, no throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const res = await fetchLedger('demo-run');
    expect(res).toHaveProperty('error');
    expect(String(res)).not.toBe('[object Promise]');
  });

  it('turns an HTTP error status into a typed error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const res = await fetchLedger('demo-run');
    expect(res).toHaveProperty('error');
  });

  it('turns malformed JSON into a typed error, no throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken', { status: 200 })));
    const res = await fetchLedger('demo-run');
    expect(res).toHaveProperty('error');
  });

  it('rejects non-array payloads as typed errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('just a string')));
    expect(await fetchLedger('demo-run')).toHaveProperty('error');
  });

  it('rejects a row with string tokens (would corrupt aggregates)', async () => {
    // Copilot DSH-2 round-1: tokens {in:"100"} must be a typed shape error,
    // not silently concatenated into "010050".
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { event: 'dispatch_completed', tokens: { in: '100', out: 50 } },
    ])));
    expect(await fetchLedger('demo-run')).toHaveProperty('error');
  });

  it('rejects a row with a non-numeric wall_s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { event: 'dispatch_completed', wall_s: 'fast' },
    ])));
    expect(await fetchLedger('demo-run')).toHaveProperty('error');
  });

  it('rejects a correction with string tokens in detail (nested bypass)', async () => {
    // Copilot DSH-2 round-3: detail.tokens must be validated too.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { event: 'correction', detail: { tokens: { in: '100', out: 50 } } },
    ])));
    expect(await fetchLedger('demo-run')).toHaveProperty('error');
  });
});

describe('fetchFindings', () => {
  it('parses findings rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(findings)));
    expect(await fetchFindings()).toEqual({ rows: findings });
  });

  it('surfaces a per-source {error} response as a typed error, no throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: 'state/findings.jsonl: invalid JSON at line 9' })));
    expect(await fetchFindings()).toEqual({
      error: 'state/findings.jsonl: invalid JSON at line 9',
    });
  });

  it('empty findings list is valid rows, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])));
    expect(await fetchFindings()).toEqual({ rows: [] });
  });

  it('rejects a finding with a non-string summary (would crash isEscapedDefect)', async () => {
    // Copilot DSH-2 round-1: summary:42 must be a typed shape error, not a
    // TypeError at summary.startsWith downstream.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { repo: 'demo/factory', pr: 1, round: 1, escaped_gate: true, summary: 42 },
    ])));
    expect(await fetchFindings()).toHaveProperty('error');
  });

  it('rejects a finding with a non-boolean escaped_gate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { repo: 'demo/factory', pr: 1, round: 1, escaped_gate: 'yes' },
    ])));
    expect(await fetchFindings()).toHaveProperty('error');
  });
});
