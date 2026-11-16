// DSH-3 headline cards — computed aggregates from DSH-2 metrics, missing
// data renders 'not recorded' (never 0), cost 0/null is unknown (AC 1/2).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HeadlineCards from './HeadlineCards';
import { harvestStories } from '../data/metrics';
import { allRuns, findings } from '../data/fixtures';
import { costDisplay } from '../data/format';
import type { StoryMetrics } from '../data/types';

function cardValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? '';
}

function story(partial: Partial<StoryMetrics>): StoryMetrics {
  return {
    story: 'STY-X', run: 'r', arm: 'factory', repo: 'x/y',
    coderTokens: 0, noncoderTokens: 0, overheadRatio: null,
    wallS: null, humanMin: null, costUsd: null,
    dispatches: 0, inLoopDefects: 0, tokensRecorded: false, rounds: null, ...partial,
  };
}

describe('costDisplay (AC 2: cost is tokens-only until a price table)', () => {
  it('renders null, undefined and 0 as not recorded', () => {
    expect(costDisplay(null)).toBe('not recorded');
    expect(costDisplay(undefined)).toBe('not recorded');
    expect(costDisplay(0)).toBe('not recorded');
  });
  it('renders a nonzero cost to 2 decimals', () => {
    expect(costDisplay(1.5)).toBe('1.50');
    expect(costDisplay(2)).toBe('2.00');
    expect(costDisplay(3.456)).toBe('3.46');
  });
  it('renders non-finite values as not recorded', () => {
    expect(costDisplay(NaN)).toBe('not recorded');
    expect(costDisplay(Infinity)).toBe('not recorded');
  });
});

describe('HeadlineCards', () => {
  it('renders computed aggregates over the full fixture scope', () => {
    render(<HeadlineCards stories={harvestStories(allRuns, findings)} escapedDefects={3} />);
    expect(cardValue('Total tokens')).toBe('1565');
    // STY-A's only recorded cost is a 0 correction -> unknown, not $0.00.
    expect(cardValue('Cost (USD)')).toBe('not recorded');
    expect(cardValue('Escaped defects')).toBe('3');
    expect(cardValue('Mean review rounds')).toBe('3.50');
    expect(cardValue('Overhead ratio')).toBe('0.34');
  });

  it('renders missing data as not recorded, never 0', () => {
    // STY-B: reviewer-only (coder 0 -> overhead null), no cost recorded.
    const stories = harvestStories(allRuns, findings).filter((s) => s.story === 'STY-B');
    render(<HeadlineCards stories={stories} escapedDefects={null} />);
    expect(cardValue('Cost (USD)')).toBe('not recorded');
    expect(cardValue('Escaped defects')).toBe('not recorded');
    expect(cardValue('Overhead ratio')).toBe('not recorded');
    expect(cardValue('Mean review rounds')).toBe('4');
  });

  it('excludes control-arm stories from mean review rounds', () => {
    const stories = harvestStories(allRuns, findings).filter((s) => s.arm === 'control');
    render(<HeadlineCards stories={stories} escapedDefects={1} />);
    expect(cardValue('Mean review rounds')).toBe('not recorded');
  });

  it('renders a nonzero aggregate cost to 2 decimals', () => {
    const stories = [story({ costUsd: 1.25 }), story({ story: 'STY-Y', costUsd: 2.2 })];
    render(<HeadlineCards stories={stories} escapedDefects={0} />);
    expect(cardValue('Cost (USD)')).toBe('3.45');
    // Zero escaped defects IS a real count when findings loaded fine.
    expect(cardValue('Escaped defects')).toBe('0');
  });

  it('renders total tokens as not recorded when no usage was recorded', () => {
    render(<HeadlineCards stories={[story({})]} escapedDefects={0} />);
    expect(cardValue('Total tokens')).toBe('not recorded');
  });

  it('distinguishes missing usage from recorded zero via harvest (Copilot F1)', () => {
    // A dispatch with NULL tokens: dispatches=1 but tokensRecorded=false ->
    // 'not recorded'. A dispatch with tokens {in:0,out:0}: tokensRecorded=true
    // -> '0'. The old dispatch-count heuristic showed '0' for both.
    const missing = harvestStories([{ run: 'r', rows: [
      { event: 'dispatch_completed', story: 'M', role: 'coder', repo: 'x/y' },
    ] as never }], []);
    const { unmount } = render(<HeadlineCards stories={missing} escapedDefects={0} />);
    expect(cardValue('Total tokens')).toBe('not recorded');
    unmount();

    const zero = harvestStories([{ run: 'r', rows: [
      { event: 'dispatch_completed', story: 'Z', role: 'coder', repo: 'x/y',
        tokens: { in: 0, out: 0 } },
    ] as never }], []);
    render(<HeadlineCards stories={zero} escapedDefects={0} />);
    expect(cardValue('Total tokens')).toBe('0');
  });

  it('a zero-token CORRECTION marks usage recorded (Copilot round-3)', () => {
    // Dispatch has missing tokens; a correction supplies detail.tokens
    // {in:0,out:0}. tokensRecorded must become true -> '0', not 'not recorded'.
    const stories = harvestStories([{ run: 'r', rows: [
      { event: 'dispatch_completed', story: 'C', role: 'coder', repo: 'x/y' },
      { event: 'correction', story: 'C', role: 'coder',
        detail: { tokens: { in: 0, out: 0 } } },
    ] as never }], []);
    render(<HeadlineCards stories={stories} escapedDefects={0} />);
    expect(cardValue('Total tokens')).toBe('0');
  });
});
