// DSH-3 data hook — orchestrates DSH-2's fetch functions (no reimplementation):
// discover runs, load every run's ledger + findings. Per-source errors are
// collected as typed strings; a failed source never crashes the others.
import { useEffect, useState } from 'react';
import { fetchFindings, fetchLedger, fetchRuns } from '../data/api';
import type { FindingRow, RunLedger } from '../data/types';

export interface DashboardData {
  loading: boolean;
  runs: string[];
  ledgers: RunLedger[];
  /** null when the findings source failed — escaped defects are unknown. */
  findings: FindingRow[] | null;
  errors: string[];
}

export function useDashboardData(): DashboardData {
  const [data, setData] = useState<DashboardData>({
    loading: true, runs: [], ledgers: [], findings: null, errors: [],
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const runsRes = await fetchRuns();
      if (cancelled) return;
      if ('error' in runsRes) {
        setData({ loading: false, runs: [], ledgers: [], findings: null, errors: [runsRes.error] });
        return;
      }
      const runs = runsRes.rows;
      const [findingsRes, ...ledgerRes] = await Promise.all([
        fetchFindings(),
        ...runs.map((run) => fetchLedger(run)),
      ]);
      if (cancelled) return;
      const errors: string[] = [];
      const ledgers: RunLedger[] = [];
      runs.forEach((run, i) => {
        const res = ledgerRes[i];
        if ('error' in res) errors.push(res.error);
        else ledgers.push({ run, rows: res.rows });
      });
      let findings: FindingRow[] | null = null;
      if ('error' in findingsRes) errors.push(findingsRes.error);
      else findings = findingsRes.rows;
      setData({ loading: false, runs, ledgers, findings, errors });
    })();
    return () => { cancelled = true; };
  }, []);
  return data;
}
