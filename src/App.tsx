/// <reference types="vite/client" />
// DSH-3 composite — scope selector ABOVE the data views; all views recompute
// from the selected run subset (AC 3). Prefs persist in 'factory-dash:prefs'
// (AC 4); empty scope and per-source errors get their own states (AC 5).
import { useEffect, useMemo, useState } from 'react';
import './index.css';
import HeadlineCards from './components/HeadlineCards';
import ScopeSelector from './components/ScopeSelector';
import StoryTable from './components/StoryTable';
import Trends from './components/Trends';
import { useDashboardData } from './hooks/useDashboardData';
import { ALL, escapedDefectsByRepo, harvestStories, selectRuns } from './data/metrics';

const PREFS_KEY = 'factory-dash:prefs';

function loadScope(): string {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return typeof prefs?.run === 'string' ? prefs.run : ALL;
  } catch {
    return ALL;
  }
}

export default function App() {
  const { loading, runs, ledgers, findings, errors } = useDashboardData();
  const [scope, setScope] = useState<string>(loadScope);

  const changeScope = (run: string) => {
    setScope(run);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ run }));
    } catch { /* prefs are best-effort; the view still works */ }
  };

  // Reconcile a stale saved scope: if the persisted run no longer exists in
  // the discovered runs, fall back to ALL so data isn't hidden and a scope
  // button stays active (Copilot DSH-3 round-4).
  useEffect(() => {
    if (!loading && scope !== ALL && !runs.includes(scope)) {
      setScope(ALL);
    }
  }, [loading, runs, scope]);

  const stories = useMemo(
    // Pass findings through (null when the source failed): rounds fall back
    // to the ledger's loop_converged detail.rounds inside harvest — a valid
    // independent source (DSH-3 review F3) — while per-story escaped defects
    // stay null to signal findings unavailable (DSH-4 AC 5).
    () => harvestStories(selectRuns(ledgers, scope), findings),
    [ledgers, scope, findings],
  );
  // Escaped defects are per-repo (PRD formula 1); attribute them to the
  // repos present in the selected run scope. Unknown when findings failed.
  const escapedDefects = useMemo(() => {
    if (findings === null) return null;
    const byRepo = escapedDefectsByRepo(findings);
    if (scope === ALL) return Object.values(byRepo).reduce((sum, n) => sum + n, 0);
    const repos = new Set(stories.map((s) => s.repo).filter((r): r is string => r != null));
    let total = 0;
    for (const repo of repos) total += byRepo[repo] ?? 0;
    return total;
  }, [findings, scope, stories]);

  return (
    <div>
      <ScopeSelector runs={runs} value={scope} onChange={changeScope} />
      {errors.length > 0 && (
        <div className="dash-card">
          <div className="dash-error" role="alert">
            <strong>Could not read a data source.</strong>
            {errors.map((e) => <p key={e}>{e}</p>)}
          </div>
        </div>
      )}
      {loading ? (
        <div className="dash-card">
          <h1 className="dash-title">Factory dashboard</h1>
          <p className="dash-empty">Loading factory data…</p>
        </div>
      ) : stories.length === 0 ? (
        <div className="dash-card">
          <h1 className="dash-title">Factory dashboard</h1>
          <p className="dash-empty">No story data in this scope yet.</p>
        </div>
      ) : (
        <>
          <HeadlineCards
            stories={stories}
            escapedDefects={escapedDefects}
            sub={scope === ALL ? 'All runs' : scope}
          />
          <StoryTable stories={stories} />
          <Trends stories={stories} runs={selectRuns(ledgers, scope)} />
        </>
      )}
    </div>
  );
}
