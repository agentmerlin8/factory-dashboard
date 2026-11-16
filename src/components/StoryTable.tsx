// DSH-4 per-story table — wireframe StoryTable structure/classes wired to
// DSH-2's harvestStories output (reuse, no reimplementation). Sortable by
// rounds/escaped/wall only (AC 2); nulls render 'not recorded', never 0
// (AC 3); cost is a headline card, NOT a column. Sorting is the pure
// sortStories function below — no inline sort logic in the JSX (AC 6).
import { useState } from 'react';
import { fmt } from '../data/format';
import type { StoryMetrics } from '../data/types';

export type SortKey = 'rounds' | 'escaped' | 'wall';
export type SortDir = 'asc' | 'desc';

function sortValue(s: StoryMetrics, key: SortKey): number | null {
  if (key === 'rounds') return s.rounds;
  if (key === 'wall') return s.wallS;
  return s.escapedDefects ?? null;
}

/** Pure, non-mutating sort over StoryMetrics[]. Nulls sort LAST in both
 * directions (a missing measurement is not a small number); ties keep
 * input order (stable sort). Unit-tested; the component renders from it. */
export function sortStories(stories: StoryMetrics[], key: SortKey, dir: SortDir): StoryMetrics[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...stories].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sign * (av - bv);
  });
}

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'rounds', label: 'Rounds' },
  { key: 'escaped', label: 'Escaped' },
  { key: 'wall', label: 'Wall s' },
];

interface Props {
  stories: StoryMetrics[];
}

export default function StoryTable({ stories }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('rounds');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  if (stories.length === 0) {
    return (
      <div className="dash-card">
        <h2 className="dash-title">Per-story</h2>
        <p className="dash-empty">No story data in this scope yet.</p>
      </div>
    );
  }

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const rows = sortStories(stories, sortKey, sortDir);
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const sortHeader = (key: SortKey, label: string) => (
    <th scope="col" aria-sort={ariaSort(key)}>
      <button type="button" className="dash-sort" onClick={() => toggleSort(key)}>
        {label}
      </button>
    </th>
  );
  // Token usage renders 'not recorded' unless usage was actually recorded —
  // a dispatch with null tokens must not display as a recorded zero.
  const tokens = (s: StoryMetrics, n: number) => (s.tokensRecorded ? fmt(n) : 'not recorded');

  return (
    <div className="dash-card">
      <h2 className="dash-title">Per-story</h2>
      <table className="dash-table">
        <thead>
          <tr>
            <th scope="col">Story</th>
            <th scope="col">Arm/run</th>
            <th scope="col">Coder tok</th>
            <th scope="col">Non-coder tok</th>
            <th scope="col">Overhead</th>
            {SORT_COLUMNS.map((c) => sortHeader(c.key, c.label))}
            <th scope="col">Human min</th>
            <th scope="col">Model(s)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.run + '::' + s.story}>
              <td>{s.story}</td>
              <td>{s.arm} · {s.run}</td>
              <td>{tokens(s, s.coderTokens)}</td>
              <td>{tokens(s, s.noncoderTokens)}</td>
              <td>{fmt(s.overheadRatio)}</td>
              <td>{fmt(s.rounds)}</td>
              <td>{fmt(s.escapedDefects ?? null)}</td>
              <td>{fmt(s.wallS)}</td>
              <td>{fmt(s.humanMin)}</td>
              <td className="dash-model">{s.models?.length ? s.models.join(', ') : 'not recorded'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
