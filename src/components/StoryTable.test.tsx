// DSH-4 per-story table — rows from DSH-2 harvestStories (reuse), nulls ->
// 'not recorded' / recorded 0 -> 0, three sort columns with aria-sort, pure
// unit-tested sort, escaped defects joined on repo+pr (AC 1-6).
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import StoryTable, { sortStories } from './StoryTable';
import { harvestStories } from '../data/metrics';
import { allRuns, findings, REPOS } from '../data/fixtures';
import type { FindingRow, StoryMetrics } from '../data/types';

const stories = harvestStories(allRuns, findings);

function story(partial: Partial<StoryMetrics>): StoryMetrics {
  return {
    story: 'STY-X', run: 'r', arm: 'factory', repo: 'x/y',
    coderTokens: 0, noncoderTokens: 0, overheadRatio: null,
    wallS: null, humanMin: null, costUsd: null,
    dispatches: 0, inLoopDefects: 0, tokensRecorded: false, coderTokensRecorded: false, noncoderTokensRecorded: false, rounds: null, ...partial,
  };
}

/** Cell texts of the body row whose first cell is the story id. */
function rowCells(id: string): string[] {
  const row = screen.getByText(id).closest('tr');
  if (!row) throw new Error(`no row for ${id}`);
  return within(row).getAllByRole('cell').map((c) => c.textContent ?? '');
}

/** Story ids in rendered body order (header row skipped). */
function rowOrder(): string[] {
  return screen.getAllByRole('row').slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');
}

function columnHeader(name: RegExp): HTMLElement {
  return screen.getByRole('columnheader', { name });
}

// --- AC 6: sorting is a pure function over StoryMetrics[] -------------------
describe('sortStories (pure)', () => {
  const a = story({ story: 'A', rounds: 3, escapedDefects: 2, wallS: 180 });
  const b = story({ story: 'B', rounds: 4, escapedDefects: 0, wallS: 30 });
  const c = story({ story: 'C', rounds: null, escapedDefects: null, wallS: null });
  const d = story({ story: 'D', rounds: 10, escapedDefects: 1, wallS: 500 });
  const input = [a, b, c, d];

  it('sorts ascending and descending by each key', () => {
    expect(sortStories(input, 'rounds', 'asc').map((s) => s.story)).toEqual(['A', 'B', 'D', 'C']);
    expect(sortStories(input, 'rounds', 'desc').map((s) => s.story)).toEqual(['D', 'B', 'A', 'C']);
    expect(sortStories(input, 'escaped', 'asc').map((s) => s.story)).toEqual(['B', 'D', 'A', 'C']);
    expect(sortStories(input, 'escaped', 'desc').map((s) => s.story)).toEqual(['A', 'D', 'B', 'C']);
    expect(sortStories(input, 'wall', 'asc').map((s) => s.story)).toEqual(['B', 'A', 'D', 'C']);
    expect(sortStories(input, 'wall', 'desc').map((s) => s.story)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('nulls sort last in BOTH directions (missing is not a small number)', () => {
    const asc = sortStories(input, 'wall', 'asc');
    const desc = sortStories(input, 'wall', 'desc');
    expect(asc[asc.length - 1].story).toBe('C');
    expect(desc[desc.length - 1].story).toBe('C');
  });

  it('does not mutate the input and is stable for ties', () => {
    const before = input.map((s) => s.story);
    sortStories(input, 'rounds', 'desc');
    expect(input.map((s) => s.story)).toEqual(before);
    const t1 = story({ story: 'T1', rounds: 2 });
    const t2 = story({ story: 'T2', rounds: 2 });
    expect(sortStories([t1, t2], 'rounds', 'asc').map((s) => s.story)).toEqual(['T1', 'T2']);
    expect(sortStories([t1, t2], 'rounds', 'desc').map((s) => s.story)).toEqual(['T1', 'T2']);
  });

  it('treats undefined escapedDefects (legacy view model) as null', () => {
    const legacy = story({ story: 'L' }); // no escapedDefects field
    expect(sortStories([legacy, b], 'escaped', 'asc').map((s) => s.story)).toEqual(['B', 'L']);
  });
});

// --- AC 1/3: rows, columns, nulls vs recorded zeros --------------------------
describe('StoryTable rows', () => {
  it('renders one row per story with harvest-derived values', () => {
    render(<StoryTable stories={stories} />);
    expect(screen.getAllByRole('row')).toHaveLength(5); // header + 4 stories
    // STY-A: coder 150, noncoder 300, ratio 2, rounds 3, escaped 2, wall 180,
    // human 5, models coder-model + review-model (correction adds no model).
    expect(rowCells('STY-A')).toEqual([
      'STY-A', 'factory · demo-run', '150', '300', '2', '3', '2', '180', '5',
      'coder-model, review-model',
    ]);
    expect(rowCells('CTL-1')[1]).toBe('control · control-run');
  });

  it('nulls render not recorded, never 0; recorded zeros render 0', () => {
    render(<StoryTable stories={stories} />);
    const c = rowCells('STY-C');
    expect(c[4]).toBe('0');              // recorded ratio 0 (15 coder, 0 non)
    expect(c[5]).toBe('not recorded');   // rounds null
    expect(c[6]).toBe('not recorded');   // no PR -> escaped unknown
    expect(c[7]).toBe('not recorded');   // wall null
    expect(c[8]).toBe('not recorded');   // human null
    const b = rowCells('STY-B');
    expect(b[2]).toBe('not recorded');   // reviewer-only: coder usage never recorded
    expect(b[3]).toBe('100');            // reviewer tokens recorded (90+10)
    expect(b[4]).toBe('not recorded');   // overhead null (coder == 0)
    expect(b[6]).toBe('0');              // PR 2 has findings, none escaped
    expect(b[8]).toBe('not recorded');   // human null
  });

  it('unrecorded token usage renders not recorded, not 0', () => {
    const missing = harvestStories([{ run: 'r', rows: [
      { event: 'dispatch_completed', story: 'M', role: 'coder', repo: 'x/y' },
    ] as never }], []);
    render(<StoryTable stories={missing} />);
    const m = rowCells('M');
    expect(m[2]).toBe('not recorded');
    expect(m[3]).toBe('not recorded');
    expect(m[9]).toBe('not recorded'); // no model recorded
  });

  it('has the ten AC columns, th scope=col, and NO cost column', () => {
    render(<StoryTable stories={stories} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      'Story', 'Arm/run', 'Coder tok', 'Non-coder tok', 'Overhead',
      'Rounds', 'Escaped', 'Wall s', 'Human min', 'Model(s)',
    ]);
    for (const h of headers) expect(h).toHaveAttribute('scope', 'col');
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
  });
});

// --- AC 2: three sort columns, toggle, aria-sort, real buttons ---------------
describe('StoryTable sorting', () => {
  it('defaults to rounds descending and toggles asc/desc on click', () => {
    render(<StoryTable stories={stories} />);
    expect(rowOrder()).toEqual(['CTL-1', 'STY-B', 'STY-A', 'STY-C']);
    expect(columnHeader(/rounds/i)).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: /rounds/i }));
    expect(rowOrder()).toEqual(['STY-A', 'STY-B', 'CTL-1', 'STY-C']);
    expect(columnHeader(/rounds/i)).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: /rounds/i }));
    expect(columnHeader(/rounds/i)).toHaveAttribute('aria-sort', 'descending');
    expect(rowOrder()).toEqual(['CTL-1', 'STY-B', 'STY-A', 'STY-C']);
  });

  it('sorts by escaped defects; aria-sort moves to the active column', () => {
    render(<StoryTable stories={stories} />);
    fireEvent.click(screen.getByRole('button', { name: /escaped/i }));
    expect(rowOrder()).toEqual(['STY-A', 'STY-B', 'STY-C', 'CTL-1']);
    expect(columnHeader(/escaped/i)).toHaveAttribute('aria-sort', 'descending');
    expect(columnHeader(/rounds/i)).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(screen.getByRole('button', { name: /escaped/i }));
    expect(rowOrder()).toEqual(['STY-B', 'STY-A', 'STY-C', 'CTL-1']);
    expect(columnHeader(/escaped/i)).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sorts by wall time with nulls last', () => {
    render(<StoryTable stories={stories} />);
    fireEvent.click(screen.getByRole('button', { name: /wall/i }));
    expect(rowOrder()).toEqual(['CTL-1', 'STY-A', 'STY-B', 'STY-C']);
    expect(columnHeader(/wall/i)).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: /wall/i }));
    expect(rowOrder()).toEqual(['STY-B', 'STY-A', 'CTL-1', 'STY-C']);
    expect(columnHeader(/wall/i)).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sortable headers are real dash-sort buttons; static headers are not', () => {
    render(<StoryTable stories={stories} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b).toHaveClass('dash-sort');
    expect(within(columnHeader(/story/i)).queryByRole('button')).not.toBeInTheDocument();
    expect(within(columnHeader(/human min/i)).queryByRole('button')).not.toBeInTheDocument();
  });
});

// --- AC 4: empty scope --------------------------------------------------------
describe('StoryTable empty state', () => {
  it('shows a friendly empty state, not a blank table', () => {
    render(<StoryTable stories={[]} />);
    expect(screen.getByText(/no story data in this scope/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

// --- AC 5: escaped defects join findings on repo+pr ---------------------------
describe('per-story escaped defects (repo+pr join)', () => {
  it('attributes only findings matching BOTH repo and pr', () => {
    // Same pr number in a different repo must NOT leak into STY-A's count.
    const extra: FindingRow = {
      repo: 'other/repo', pr: 1, round: 1, escaped_gate: true,
      summary: 'escape elsewhere', klass: 'bug', disposition: 'fixed',
    };
    const joined = harvestStories(allRuns, [...findings, extra]);
    render(<StoryTable stories={joined} />);
    expect(rowCells('STY-A')[6]).toBe('2'); // not 3
    expect(rowCells('STY-B')[6]).toBe('0'); // pr 2: findings exist, none escaped
  });

  it('excludes false-positive/rejected/RESOLVED via the shared formula', () => {
    // Fixture pr 1 carries fp/rejected/RESOLVED/non-escaped rows alongside
    // the 2 genuine escapes — the count must stay 2 (formula single-sourced).
    render(<StoryTable stories={stories} />);
    expect(rowCells('STY-A')[6]).toBe('2');
    expect(REPOS.demo).toBe('demo/factory');
  });

  it('findings source failed (null) -> escaped not recorded, rounds fall back', () => {
    const noFindings = harvestStories(allRuns, null);
    render(<StoryTable stories={noFindings} />);
    expect(rowCells('STY-A')[6]).toBe('not recorded');
    expect(rowCells('STY-B')[6]).toBe('not recorded');
    // rounds still come from the ledger fallback (STY-A loop_converged 9).
    expect(rowCells('STY-A')[5]).toBe('9');
  });

  it('per-role token availability: missing coder usage shows not-recorded even when reviewer usage is recorded (Copilot DSH-4)', () => {
    // Coder dispatch has null tokens; reviewer dispatch has recorded usage.
    // Coder column must be 'not recorded', non-coder column a real number.
    const stories = harvestStories([{ run: 'r', rows: [
      { event: 'dispatch_completed', story: 'PR', role: 'coder', repo: 'x/y' },
      { event: 'dispatch_completed', story: 'PR', role: 'reviewer', repo: 'x/y',
        tokens: { in: 500, out: 50 } },
    ] as never }], []);
    render(<StoryTable stories={stories} />);
    const cells = rowCells('PR');
    expect(cells[2]).toBe('not recorded');  // coder tokens missing
    expect(cells[3]).toBe('550');           // non-coder recorded
  });
});
