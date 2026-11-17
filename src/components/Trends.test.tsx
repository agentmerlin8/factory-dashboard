// DSH-5 trends — three bar charts wired to DSH-2 harvestStories (reuse).
// Aggregation is pure unit-tested functions (AC 6); the component renders
// from them with no inline math. Nulls -> 'not recorded' / 0-height, never a
// fabricated 0 (AC 1-4); max-normalized with a max=0 guard (no NaN).
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import Trends, { compactTokens } from './Trends';
import { barPct, escapedBars, harvestStories, roundsBars, tokensByModel } from '../data/metrics';
import { allRuns, controlRun, factoryRun, findings } from '../data/fixtures';
import type { LedgerRow, RunLedger, StoryMetrics } from '../data/types';

const stories = harvestStories(allRuns, findings);

function story(partial: Partial<StoryMetrics>): StoryMetrics {
  return {
    story: 'STY-X', run: 'r', arm: 'factory', repo: 'x/y',
    coderTokens: 0, noncoderTokens: 0, overheadRatio: null,
    wallS: null, humanMin: null, costUsd: null,
    dispatches: 0, inLoopDefects: 0, tokensRecorded: false,
    coderTokensRecorded: false, noncoderTokensRecorded: false,
    rounds: null, ...partial,
  };
}

function ledger(partial: Partial<LedgerRow> & Pick<LedgerRow, 'event'>): LedgerRow {
  return { schema: 0, story: null, role: null, repo: null, model: null, tokens: null, detail: {}, ...partial };
}

// --- AC 6: pure aggregation helpers -----------------------------------------
describe('barPct (pure normalization)', () => {
  it('max-normalizes to a percentage', () => {
    expect(barPct(4, 4)).toBe(100);
    expect(barPct(2, 4)).toBe(50);
    expect(barPct(0, 4)).toBe(0);
  });
  it('guards max=0 and null — never NaN / divide-by-zero', () => {
    expect(barPct(5, 0)).toBe(0);
    expect(barPct(null, 0)).toBe(0);
    expect(barPct(null, 10)).toBe(0);
    expect(Number.isNaN(barPct(3, 0))).toBe(false);
  });
});

describe('roundsBars (pure)', () => {
  it('includes factory-arm stories only, max-normalized heights', () => {
    const bars = roundsBars(stories);
    expect(bars.map((b) => b.label)).toEqual(['STY-A', 'STY-B', 'STY-C']); // CTL-1 excluded
    const byLabel = Object.fromEntries(bars.map((b) => [b.label, b]));
    expect(byLabel['STY-A'].value).toBe(3);
    expect(byLabel['STY-B'].value).toBe(4);
    expect(byLabel['STY-B'].pct).toBe(100); // max
    expect(byLabel['STY-A'].pct).toBe(75);  // 3/4
    expect(byLabel['STY-A'].title).toBe('demo-run/STY-A: 3 rounds');
  });
  it('null rounds -> 0-height bar + not-recorded title, never 0 rounds', () => {
    const bars = roundsBars(stories);
    const c = bars.find((b) => b.label === 'STY-C')!;
    expect(c.value).toBeNull();
    expect(c.pct).toBe(0);
    expect(c.title).toBe('demo-run/STY-C: not recorded');
  });
  it('all-null rounds (max=0) -> every bar 0, no NaN', () => {
    const bars = roundsBars([story({ story: 'A', rounds: null }), story({ story: 'B', rounds: null })]);
    expect(bars.every((b) => b.pct === 0)).toBe(true);
    expect(bars.every((b) => !Number.isNaN(b.pct))).toBe(true);
  });
});

describe('escapedBars (pure)', () => {
  it('includes all arms; control label distinguished; min divisor 1', () => {
    const bars = escapedBars(stories);
    expect(bars.map((b) => b.label)).toEqual(['STY-A', 'STY-B', 'STY-C', 'ctl CTL-1']);
    const a = bars.find((b) => b.label === 'STY-A')!;
    expect(a.value).toBe(2);
    expect(a.pct).toBe(100); // max 2
    expect(a.title).toBe('demo-run/STY-A (factory): 2 escaped');
    const b = bars.find((b) => b.label === 'STY-B')!;
    expect(b.value).toBe(0); // a joined PR with zero escapes is a real 0
    expect(b.pct).toBe(0);
  });
  it('null escaped -> 0-height + not-recorded title (never fabricated)', () => {
    const bars = escapedBars(stories);
    for (const label of ['STY-C', 'ctl CTL-1']) {
      const bar = bars.find((b) => b.label === label)!;
      expect(bar.value).toBeNull();
      expect(bar.pct).toBe(0);
      expect(bar.title).toContain('not recorded');
    }
  });
  it('all-null escaped (max floor 1) -> 0-height, no NaN', () => {
    const bars = escapedBars([story({ story: 'A', escapedDefects: null })]);
    expect(bars[0].pct).toBe(0);
    expect(Number.isNaN(bars[0].pct)).toBe(false);
  });
});

describe('tokensByModel (pure)', () => {
  it('groups dispatch tokens by model across the scope, max-normalized widths', () => {
    const mix = tokensByModel(allRuns);
    expect(mix.map((m) => m.model)).toEqual(['coder-model', 'review-model']); // desc by tokens
    const coder = mix.find((m) => m.model === 'coder-model')!;
    const review = mix.find((m) => m.model === 'review-model')!;
    expect(coder.tokens).toBe(1165); // 150 + 15 + 1000
    expect(review.tokens).toBe(175); // 75 + 100
    expect(coder.pct).toBe(100);
    expect(review.pct).toBeCloseTo((175 / 1165) * 100, 5);
  });
  it('excludes models with no recorded usage; a recorded zero IS usage', () => {
    const runs: RunLedger[] = [{
      run: 'r', rows: [
        ledger({ event: 'dispatch_completed', story: 'S', model: 'ghost', tokens: null }),
        ledger({ event: 'dispatch_completed', story: 'S', model: 'ghost', tokens: {} }),
        ledger({ event: 'dispatch_completed', story: 'S', model: 'zero', tokens: { in: 0, out: 0 } }),
        ledger({ event: 'dispatch_completed', story: 'S', model: 'real', tokens: { in: 10, out: 5 } }),
      ],
    }];
    const mix = tokensByModel(runs);
    expect(mix.map((m) => m.model)).toEqual(['real', 'zero']); // ghost excluded
    expect(mix.find((m) => m.model === 'zero')!.tokens).toBe(0);
  });
  it('sums correction tokens grouped by row.model (only hasUsage rows)', () => {
    const runs: RunLedger[] = [{
      run: 'r', rows: [
        ledger({ event: 'dispatch_completed', story: 'S', model: 'm', tokens: { in: 10, out: 0 } }),
        ledger({ event: 'correction', story: 'S', role: 'coder', model: 'm', detail: { tokens: { in: 5, out: 5 } } }),
        ledger({ event: 'correction', story: 'S', role: 'coder', model: 'm', detail: { tokens: null } }),
        ledger({ event: 'correction', story: 'S', role: 'coder', detail: { tokens: { in: 99, out: 99 } } }), // no model -> unattributed
      ],
    }];
    expect(tokensByModel(runs)).toEqual([{ model: 'm', tokens: 20, pct: 100 }]);
  });
  it('widths are sane: finite, within [0,100], max model = 100', () => {
    const mix = tokensByModel(allRuns);
    expect(mix.every((m) => Number.isFinite(m.pct) && m.pct >= 0 && m.pct <= 100)).toBe(true);
    expect(Math.max(...mix.map((m) => m.pct))).toBe(100);
  });
  it('no recorded usage -> empty list (max=0 guard, no NaN)', () => {
    expect(tokensByModel([{ run: 'r', rows: [ledger({ event: 'dispatch_completed', model: 'g', tokens: null })] }])).toEqual([]);
    expect(tokensByModel([])).toEqual([]);
  });
});

describe('compactTokens (pure formatting)', () => {
  it('formats large totals compactly, small totals exactly', () => {
    expect(compactTokens(7_760_000)).toBe('7.76M');
    expect(compactTokens(1165)).toBe('1.2k');
    expect(compactTokens(175)).toBe('175');
    expect(compactTokens(0)).toBe('0');
  });
  it('non-finite -> not recorded', () => {
    expect(compactTokens(NaN)).toBe('not recorded');
  });
  it('trims trailing zeros on round values (review nit)', () => {
    expect(compactTokens(1_000_000)).toBe('1M');
    expect(compactTokens(1_500_000)).toBe('1.5M');
    expect(compactTokens(2_000)).toBe('2k');
  });
});

// --- AC 1-5: component renders from the pure functions ----------------------
function barsIn(label: string): HTMLElement[] {
  const chart = screen.getByRole('img', { name: label });
  return Array.from(chart.querySelectorAll('.dash-bar'));
}

describe('Trends component', () => {
  it('renders rounds bars factory-arm only with proportional heights + titles', () => {
    render(<Trends stories={stories} runs={allRuns} />);
    const bars = barsIn('Review rounds per story');
    expect(bars).toHaveLength(3);
    const a = bars.find((b) => b.closest('.dash-bar-col')?.getAttribute('title') === 'demo-run/STY-A: 3 rounds')!;
    const b = bars.find((b) => b.closest('.dash-bar-col')?.getAttribute('title') === 'demo-run/STY-B: 4 rounds')!;
    expect(a.style.height).toBe('75%');
    expect(b.style.height).toBe('100%');
    expect(screen.queryByTitle(/CTL-1.*rounds/)).not.toBeInTheDocument();
  });

  it('renders escaped bars for all arms; null -> 0-height + not-recorded title', () => {
    render(<Trends stories={stories} runs={allRuns} />);
    const bars = barsIn('Escaped defects per story');
    expect(bars).toHaveLength(4);
    const nullBar = bars.find((b) => (b.closest('.dash-bar-col')?.getAttribute('title') ?? '').includes('STY-C'))!;
    expect(nullBar.style.height).toBe('0%');
    expect(nullBar.closest('.dash-bar-col')?.getAttribute('title')).toContain('not recorded');
    expect(nullBar.className).toContain('dash-bar--null');
    // control label distinguishes the arm
    expect(screen.getByText('ctl CTL-1')).toBeInTheDocument();
    // distinct defect bar color class
    expect(bars.every((b) => b.className.includes('dash-bar--defect'))).toBe(true);
  });

  it('renders model-mix rows with proportional widths + formatted totals', () => {
    render(<Trends stories={stories} runs={allRuns} />);
    const mix = screen.getByRole('img', { name: 'Model mix (tokens)' });
    const rows = within(mix).getAllByText(/coder-model|review-model/);
    expect(rows).toHaveLength(2);
    const coderBar = mix.querySelector('.dash-mix-bar') as HTMLElement;
    expect(coderBar.style.width).toBe('100%');
    expect(within(mix).getByText('1.2k')).toBeInTheDocument();
    expect(within(mix).getByText('175')).toBeInTheDocument();
  });

  it('empty scope -> friendly empty state, not blank charts', () => {
    render(<Trends stories={[]} runs={[]} />);
    expect(screen.getByText(/no story data in this scope/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('control-only scope -> rounds section empty note, escaped + mix still render', () => {
    const ctl = harvestStories([controlRun], findings);
    render(<Trends stories={ctl} runs={[controlRun]} />);
    expect(screen.getByText(/no factory-arm stories/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Escaped defects per story' })).toBeInTheDocument();
  });

  it('no recorded model usage -> mix empty note, not a blank axis', () => {
    const noUsage = harvestStories([{ run: 'r', rows: [ledger({ event: 'dispatch_completed', story: 'S', model: 'g', tokens: null })] }], findings);
    render(<Trends stories={noUsage} runs={[{ run: 'r', rows: [ledger({ event: 'dispatch_completed', story: 'S', model: 'g', tokens: null })] }]} />);
    expect(screen.getByText(/no recorded model usage/i)).toBeInTheDocument();
  });

  it('max=0 across charts renders 0-height bars, never NaN in styles', () => {
    const zero = [story({ story: 'A', rounds: null, escapedDefects: null })];
    render(<Trends stories={zero} runs={[]} />);
    for (const bar of [...barsIn('Review rounds per story'), ...barsIn('Escaped defects per story')]) {
      expect(bar.style.height).toBe('0%');
      expect(bar.style.height).not.toContain('NaN');
    }
  });

  it('unique run/story keys when a story repeats across runs (Copilot DSH-5)', () => {
    const dup = [
      story({ story: 'SAME', run: 'run-a', rounds: 3 }),
      story({ story: 'SAME', run: 'run-b', rounds: 5 }),
    ];
    const bars = roundsBars(dup);
    expect(bars.map((b) => b.id)).toEqual(['run-a/SAME', 'run-b/SAME']);
    expect(new Set(bars.map((b) => b.id)).size).toBe(2);
  });

  it('null-value tooltip is on the column, reachable at zero height (Copilot DSH-5)', () => {
    render(<Trends stories={[story({ story: 'N', rounds: null })]} runs={[]} />);
    const bar = barsIn('Review rounds per story')[0];
    expect(bar.style.height).toBe('0%');
    // title lives on the column (parent), not the zero-height bar
    expect(bar.closest('.dash-bar-col')?.getAttribute('title')).toContain('not recorded');
  });

  it('charts expose plotted data to screen readers via aria-description (Copilot DSH-5)', () => {
    render(<Trends stories={stories} runs={allRuns} />);
    const rounds = screen.getByRole('img', { name: 'Review rounds per story' });
    expect(rounds.getAttribute('aria-description')).toContain('STY-A: 3 rounds');
    const mix = screen.getByRole('img', { name: 'Model mix (tokens)' });
    expect(mix.getAttribute('aria-description')).toContain('coder-model');
  });

  it('recorded zero renders zero height, no min-height floor (Copilot DSH-5)', () => {
    // STY-B has a real 0 escaped defects -> bar height 0%, not a 4px stub.
    render(<Trends stories={stories} runs={allRuns} />);
    const bars = barsIn('Escaped defects per story');
    const zeroBar = bars.find((b) => (b.closest('.dash-bar-col')?.getAttribute('title') ?? '').includes('STY-B'))!;
    expect(zeroBar.style.height).toBe('0%');
  });

  it('bars sit in a dedicated equal-height plot area, separate from labels (Copilot DSH-5 round-3)', () => {
    render(<Trends stories={stories} runs={allRuns} />);
    const chart = screen.getByRole('img', { name: 'Review rounds per story' });
    const plots = chart.querySelectorAll('.dash-bar-plot');
    const bars = chart.querySelectorAll('.dash-bar');
    expect(plots.length).toBe(bars.length);
    // every bar is inside a plot area; labels are siblings of the plot, not in it
    for (const bar of bars) {
      expect(bar.parentElement?.className).toContain('dash-bar-plot');
    }
    for (const plot of plots) {
      expect(plot.querySelector('.dash-bar-label')).toBeNull();
    }
  });
});
