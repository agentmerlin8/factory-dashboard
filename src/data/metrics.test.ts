// DSH-2 metric tests — pure functions over fixture ledger/findings rows.
import { describe, it, expect } from 'vitest';
import {
  ALL, escapedDefectsByRepo, harvestStories, headlineOverhead, isEscapedDefect,
  meanReviewRounds, selectByRepo, selectRuns, storiesInScope,
} from './metrics';
import { fmt } from './format';
import { allRuns, controlRun, factoryRun, findings, REPOS } from './fixtures';
import type { StoryMetrics } from './types';

const stories = harvestStories(allRuns, findings);
const byStory = (id: string): StoryMetrics => {
  const s = stories.find((x) => x.story === id);
  if (!s) throw new Error(`fixture story missing: ${id}`);
  return s;
};

describe('escaped-defect formula', () => {
  it('excludes false-positive, rejected, and RESOLVED-marker findings', () => {
    const counts = escapedDefectsByRepo(findings);
    // demo repo: 2 genuine escapes; fp/rejected/RESOLVED/non-escaped excluded.
    expect(counts[REPOS.demo]).toBe(2);
    expect(counts[REPOS.control]).toBe(1);
  });

  it('counts a repo named like an Object.prototype key correctly', () => {
    // Copilot DSH-2 round-3: a repo named "constructor"/"toString" must not
    // collide with inherited properties (null-prototype record).
    const f = { repo: 'constructor', pr: 1, round: 1, escaped_gate: true,
                summary: 'real defect', klass: 'bug', disposition: 'fixed' };
    const counts = escapedDefectsByRepo([f as never]);
    expect(counts['constructor']).toBe(1);
    const f2 = { ...f, repo: 'toString' };
    expect(escapedDefectsByRepo([f2 as never])['toString']).toBe(1);
  });

  it('predicate requires an escape flag AND passes all three exclusions', () => {
    const base = findings[0]; // escaped_gate+escaped_review true, fixed
    expect(isEscapedDefect(base)).toBe(true);
    expect(isEscapedDefect({ ...base, klass: 'false-positive' })).toBe(false);
    expect(isEscapedDefect({ ...base, disposition: 'rejected' })).toBe(false);
    expect(isEscapedDefect({ ...base, summary: 'RESOLVED: marker' })).toBe(false);
    expect(isEscapedDefect({ ...base, escaped_gate: false, escaped_review: false })).toBe(false);
    // either flag alone is enough
    expect(isEscapedDefect({ ...base, escaped_review: false })).toBe(true);
    expect(isEscapedDefect({ ...base, escaped_gate: false })).toBe(true);
  });
});

describe('overhead ratio', () => {
  it('per-story is null when coder_tokens == 0', () => {
    expect(byStory('STY-B').coderTokens).toBe(0);
    expect(byStory('STY-B').overheadRatio).toBeNull();
  });

  it('per-story is noncoder/coder when coder tokens exist', () => {
    // STY-A: coder 150, noncoder 75 + 225 correction = 300 -> 2.
    expect(byStory('STY-A').overheadRatio).toBe(2);
    // STY-C: coder 15, noncoder 0 -> a real computed 0, not null.
    expect(byStory('STY-C').overheadRatio).toBe(0);
  });

  it('headline is AGGREGATE sum(noncoder)/sum(coder), not mean of ratios', () => {
    // all scope: coder 150+0+15+1000=1165, noncoder 300+100+0+0=400.
    const expected = 400 / 1165;
    expect(headlineOverhead(stories)).toBe(expected);
    const ratios = stories.map((s) => s.overheadRatio).filter((r): r is number => r !== null);
    const meanOfRatios = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(headlineOverhead(stories)).not.toBe(meanOfRatios);
  });

  it('headline is null when total coder tokens == 0', () => {
    expect(headlineOverhead([byStory('STY-B')])).toBeNull();
    expect(headlineOverhead([])).toBeNull();
  });
});

describe('mean review rounds', () => {
  it('excludes the control arm and unrecorded rounds', () => {
    // factory: STY-A 3 (findings max 2 + 1 pre-PR), STY-B 4 (loop fallback),
    // STY-C null (no PR, no convergence). Control CTL-1 has rounds 10 — excluded.
    expect(byStory('STY-A').rounds).toBe(3);
    expect(byStory('STY-B').rounds).toBe(4);
    expect(byStory('STY-C').rounds).toBeNull();
    expect(byStory('CTL-1').rounds).toBe(10);
    expect(meanReviewRounds(stories)).toBe(3.5);
  });

  it('findings take precedence over loop_converged.rounds', () => {
    // STY-A loop_converged says 9; findings-derived value 3 wins.
    expect(byStory('STY-A').rounds).toBe(3);
  });

  it('is null when no factory story has recorded rounds', () => {
    expect(meanReviewRounds([byStory('STY-C'), byStory('CTL-1')])).toBeNull();
    expect(meanReviewRounds([])).toBeNull();
  });
});

describe('harvest semantics (metrics.py parity)', () => {
  it('correction re-attribution is counted by story/role', () => {
    const a = byStory('STY-A');
    expect(a.coderTokens).toBe(150);
    expect(a.noncoderTokens).toBe(300); // 75 reviewer + 225 controller correction
    expect(a.dispatches).toBe(2); // corrections are not dispatches
  });

  it('sums wall_s and human_min across dispatches and human_merged', () => {
    const a = byStory('STY-A');
    expect(a.wallS).toBe(180);
    expect(a.humanMin).toBe(5); // 2 dispatch + 3 human_merged
  });

  it('null human_min stays null (never 0); missing wall_s stays null', () => {
    expect(byStory('STY-B').humanMin).toBeNull();
    expect(byStory('STY-C').humanMin).toBeNull();
    expect(byStory('STY-C').wallS).toBeNull();
    expect(byStory('STY-C').costUsd).toBeNull();
  });

  it('records arm and repo per story', () => {
    expect(byStory('STY-A').arm).toBe('factory');
    expect(byStory('STY-A').run).toBe('demo-run');
    expect(byStory('STY-A').repo).toBe(REPOS.demo);
    expect(byStory('CTL-1').arm).toBe('control');
    expect(byStory('CTL-1').repo).toBe(REPOS.control);
  });

  it('counts in-loop defect_found events separately from escaped defects', () => {
    expect(byStory('STY-A').inLoopDefects).toBe(1);
    // the defect_found event adds nothing to the escaped-defect count
    expect(escapedDefectsByRepo(findings)[REPOS.demo]).toBe(2);
  });
});

describe('fmt helper', () => {
  it('renders null as "not recorded", never 0', () => {
    expect(fmt(null)).toBe('not recorded');
    expect(fmt(undefined)).toBe('not recorded');
  });

  it('renders recorded numbers faithfully (a real 0 stays 0)', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(3)).toBe('3');
    expect(fmt(2.5)).toBe('2.50');
  });

  it('renders non-finite values as "not recorded" (defense-in-depth)', () => {
    expect(fmt(NaN)).toBe('not recorded');
    expect(fmt(Infinity)).toBe('not recorded');
    expect(fmt(-Infinity)).toBe('not recorded');
  });
});

describe('scope filtering', () => {
  it('selects a run subset; "all" returns everything', () => {
    expect(selectRuns(allRuns, 'demo-run')).toEqual([factoryRun]);
    expect(selectRuns(allRuns, 'control-run')).toEqual([controlRun]);
    expect(selectRuns(allRuns, ALL)).toEqual(allRuns);
    expect(selectRuns(allRuns, 'nope')).toEqual([]);
  });

  it('selects rows by repo; "all" returns everything', () => {
    expect(selectByRepo(findings, REPOS.control)).toHaveLength(1);
    expect(selectByRepo(findings, ALL)).toHaveLength(findings.length);
    expect(selectByRepo(findings, 'nope')).toEqual([]);
  });

  it('storiesInScope combines run and repo filters', () => {
    expect(storiesInScope(stories, { run: 'demo-run', repo: ALL })).toHaveLength(3);
    expect(storiesInScope(stories, { run: ALL, repo: REPOS.control }).map((s) => s.story))
      .toEqual(['CTL-1']);
    expect(storiesInScope(stories, { run: ALL, repo: ALL })).toEqual(stories);
    expect(storiesInScope(stories, { run: 'demo-run', repo: REPOS.control })).toEqual([]);
  });

  it('headline recomputes from the scoped subset only', () => {
    const factoryOnly = storiesInScope(stories, { run: 'demo-run', repo: ALL });
    expect(headlineOverhead(factoryOnly)).toBe(400 / 165);
    expect(meanReviewRounds(factoryOnly)).toBe(3.5);
  });
});
