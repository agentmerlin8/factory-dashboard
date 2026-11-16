// DSH-3 data hook — loads runs, every run's ledger and findings via DSH-2's
// fetch functions; per-source errors are collected, never thrown (AC 3/5).
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDashboardData } from './useDashboardData';
import { controlRun, factoryRun, findings } from '../data/fixtures';

function routeFetch(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    '/api/runs': ['demo-run', 'control-run'],
    '/api/ledger?run=demo-run': factoryRun.rows,
    '/api/ledger?run=control-run': controlRun.rows,
    '/api/findings': findings,
    ...overrides,
  };
  return vi.fn(async (url: string) => new Response(
    JSON.stringify(table[url] ?? { error: url + ': no such source' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDashboardData', () => {
  it('loads runs, all ledgers and findings', async () => {
    vi.stubGlobal('fetch', routeFetch());
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual(['demo-run', 'control-run']);
    expect(result.current.ledgers).toEqual([factoryRun, controlRun]);
    expect(result.current.findings).toEqual(findings);
    expect(result.current.errors).toEqual([]);
  });

  it('keeps other sources when one ledger fails, and reports file + reason', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/ledger?run=demo-run': { error: 'runs/demo-run/ledger.jsonl: invalid JSON at line 3' },
    }));
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors).toEqual(['runs/demo-run/ledger.jsonl: invalid JSON at line 3']);
    expect(result.current.ledgers).toEqual([controlRun]);
    expect(result.current.findings).toEqual(findings);
  });

  it('sets findings to null on a findings source error (never fabricates)', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/findings': { error: 'state/findings.jsonl: permission denied' },
    }));
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.findings).toBeNull();
    expect(result.current.errors).toEqual(['state/findings.jsonl: permission denied']);
    expect(result.current.ledgers).toEqual([factoryRun, controlRun]);
  });

  it('surfaces a runs-list error with no fabricated runs', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/api/runs': { error: 'runs: unreadable' } }));
    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.runs).toEqual([]);
    expect(result.current.ledgers).toEqual([]);
    expect(result.current.errors).toEqual(['runs: unreadable']);
  });
});
