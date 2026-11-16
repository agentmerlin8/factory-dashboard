// DSH-2 derived metrics — PURE functions over parsed rows (no fetch, no
// React). Formulas are single-sourced from the approved PRD and mirror
// factory/metrics.py harvest() semantics. Nulls stay null, never 0.
import type { Arm, FindingRow, LedgerTokens, RunLedger, Scope, StoryMetrics } from './types';

export const ALL = 'all';

// --- scope filtering (AC 5) --------------------------------------------------

export function selectRuns(runs: RunLedger[], run: string): RunLedger[] {
  return run === ALL ? runs : runs.filter((r) => r.run === run);
}

export function selectByRepo<T extends { repo?: string | null }>(rows: T[], repo: string): T[] {
  return repo === ALL ? rows : rows.filter((r) => r.repo === repo);
}

export function storiesInScope(stories: StoryMetrics[], scope: Scope): StoryMetrics[] {
  return stories.filter(
    (s) => (scope.run === ALL || s.run === scope.run) && (scope.repo === ALL || s.repo === scope.repo),
  );
}

// --- escaped defects (PRD formula 1) -----------------------------------------

/** (escaped_gate OR escaped_review) AND klass != 'false-positive' AND
 * disposition != 'rejected' AND summary does not start with 'RESOLVED'
 * (resolution markers are records, not defects). Source is findings.jsonl,
 * NOT ledger defect_found events (those count in-loop findings). */
export function isEscapedDefect(f: FindingRow): boolean {
  return Boolean(f.escaped_gate || f.escaped_review)
    && f.klass !== 'false-positive'
    && f.disposition !== 'rejected'
    && !(f.summary ?? '').startsWith('RESOLVED');
}

export function escapedDefectsByRepo(findings: FindingRow[]): Record<string, number> {
  // Null-prototype object: a repo named "constructor"/"toString"/etc. must
  // not collide with Object.prototype keys (Copilot DSH-2 round-3).
  const out: Record<string, number> = Object.create(null);
  for (const f of findings) {
    if (isEscapedDefect(f)) out[f.repo] = (out[f.repo] ?? 0) + 1;
  }
  return out;
}

// --- harvest (metrics.py semantics, PRD formula 2) ----------------------------

function tokenTotal(tokens: LedgerTokens | null | undefined): number {
  return (tokens?.in ?? 0) + (tokens?.out ?? 0);
}

// True only when an actual numeric usage value is present — a tokens object
// with null/undefined in AND out (or {}) records no usage (Copilot DSH-3
// round-5: missing usage must not display as recorded zero).
function hasUsage(tokens: LedgerTokens | null | undefined): boolean {
  return tokens != null
    && (typeof tokens.in === 'number' || typeof tokens.out === 'number');
}

function detailNumber(detail: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = detail?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

interface Acc {
  story: string; run: string; arm: Arm; repo: string | null;
  coder: number; noncoder: number; wall: number | null; human: number | null;
  cost: number | null; dispatches: number; inLoopDefects: number;
  tokensRecorded: boolean;
  pr: number | null; prePrRounds: number | null; convergedRounds: number | null;
  models: string[];
}

/** Fold dispatch_completed (+ correction re-attribution by story/role),
 * human_merged, defect_found, pr_opened and loop_converged into per-story
 * metrics; rounds then come from findings per PRD formula 5. */
export function harvestStories(runs: RunLedger[], findings: FindingRow[] | null): StoryMetrics[] {
  const accs = new Map<string, Acc>();
  for (const runLedger of runs) {
    const run = runLedger.run;
    const rows = runLedger.rows;
    // Arm is a run-level fact: run_started.detail.arm === 'control' marks the
    // single-pass control arm; every other run is the factory arm.
    const arm: Arm = rows.some((r) => r.event === 'run_started' && r.detail?.arm === 'control')
      ? 'control' : 'factory';
    for (const row of rows) {
      const story = row.story;
      if (!story) continue;
      const key = run + '::' + story;
      let a = accs.get(key);
      if (!a) {
        a = {
          story, run, arm, repo: null, coder: 0, noncoder: 0, wall: null,
          human: null, cost: null, dispatches: 0, inLoopDefects: 0,
          tokensRecorded: false,
          pr: null, prePrRounds: null, convergedRounds: null, models: [],
        };
        accs.set(key, a);
      }
      if (row.repo && !a.repo) a.repo = row.repo;
      const ev = row.event;
      if (ev === 'dispatch_completed') {
        a.dispatches += 1;
        if (row.model && !a.models.includes(row.model)) a.models.push(row.model);
        const total = tokenTotal(row.tokens);
        if (hasUsage(row.tokens)) a.tokensRecorded = true;
        if (row.role === 'coder') a.coder += total; else a.noncoder += total;
        // Null-check, not truthy: a recorded ZERO duration/cost is a real
        // measurement and must accumulate (Copilot DSH-2 round-7).
        if (row.wall_s != null) a.wall = (a.wall ?? 0) + row.wall_s;
        if (row.cost_usd != null) a.cost = (a.cost ?? 0) + row.cost_usd;
        if (row.human_min != null) a.human = (a.human ?? 0) + row.human_min;
      } else if (ev === 'correction') {
        // Corrections re-attribute a dispatch's usage by story/role
        // (usage-path-bug recovery). Tokens live in detail.tokens.
        const d = row.detail ?? {};
        const corrTokens = d.tokens as LedgerTokens | null | undefined;
        // Mark recorded from non-null detail.tokens INDEPENDENTLY of the
        // accumulation guard — a zero-token correction is still recorded
        // usage (Copilot DSH-3 round-3).
        if (hasUsage(corrTokens)) a.tokensRecorded = true;
        const total = tokenTotal(corrTokens);
        if (total) {
          if (row.role === 'coder') a.coder += total; else a.noncoder += total;
          const c = detailNumber(d, 'cost_usd');
          if (c != null) a.cost = (a.cost ?? 0) + c;
        }
      } else if (ev === 'defect_found') {
        a.inLoopDefects += 1;
      } else if (ev === 'human_merged') {
        if (row.human_min != null) a.human = (a.human ?? 0) + row.human_min;
      } else if (ev === 'pr_opened') {
        const pr = detailNumber(row.detail, 'pr');
        if (pr != null) a.pr = pr;
        const pre = detailNumber(row.detail, 'pre_pr_rounds');
        if (pre != null) a.prePrRounds = pre;
      } else if (ev === 'loop_converged') {
        const pr = detailNumber(row.detail, 'pr');
        if (pr != null) a.pr = pr;
        const rounds = detailNumber(row.detail, 'rounds');
        if (rounds != null) a.convergedRounds = rounds;
      }
    }
  }
  const out: StoryMetrics[] = [];
  for (const a of accs.values()) {
    out.push({
      story: a.story, run: a.run, arm: a.arm, repo: a.repo,
      coderTokens: a.coder, noncoderTokens: a.noncoder,
      overheadRatio: a.coder === 0 ? null : a.noncoder / a.coder,
      wallS: a.wall, humanMin: a.human, costUsd: a.cost,
      dispatches: a.dispatches, inLoopDefects: a.inLoopDefects,
      tokensRecorded: a.tokensRecorded,
      rounds: storyRounds(a, findings ?? []),
      escapedDefects: storyEscapedDefects(a, findings),
      models: a.models,
    });
  }
  return out;
}

/** PRD formula (5): max round in findings for the story's PR + 1 pre-PR
 * round when present; else loop_converged detail.rounds; else null. */
function storyRounds(a: Acc, findings: FindingRow[]): number | null {
  if (a.pr != null && a.repo) {
    const rounds = findings
      .filter((f) => f.repo === a.repo && f.pr === a.pr)
      .map((f) => f.round)
      .filter((r) => typeof r === 'number' && Number.isFinite(r));
    if (rounds.length > 0) {
      return Math.max(...rounds) + (a.prePrRounds ?? 0);
    }
  }
  return a.convergedRounds;
}

/** DSH-4 (AC 5): per-story escaped defects — findings joined on repo+pr,
 * same join pattern as storyRounds, filtered by the shared isEscapedDefect
 * formula. Null when findings failed (source unavailable) or the story has
 * no recorded repo/pr to join on; a joined PR with zero escapes is a real 0. */
function storyEscapedDefects(a: Acc, findings: FindingRow[] | null): number | null {
  if (findings === null || a.pr == null || !a.repo) return null;
  return findings.filter(
    (f) => f.repo === a.repo && f.pr === a.pr && isEscapedDefect(f),
  ).length;
}

// --- headline aggregates (PRD formulas 3 and 4) -------------------------------

/** AGGREGATE sum(noncoder)/sum(coder) across scope — NOT the mean of
 * per-story ratios (matches metrics.py render_comparison headline).
 * Null when total coder tokens == 0. */
export function headlineOverhead(stories: StoryMetrics[]): number | null {
  let coder = 0;
  let noncoder = 0;
  for (const s of stories) {
    coder += s.coderTokens;
    noncoder += s.noncoderTokens;
  }
  return coder === 0 ? null : noncoder / coder;
}

/** Mean over FACTORY-arm stories with recorded rounds (control excluded:
 * single-pass, not reviewable). Null when none recorded — never 0. */
export function meanReviewRounds(stories: StoryMetrics[]): number | null {
  const rounds = stories
    .filter((s) => s.arm === 'factory' && s.rounds != null)
    .map((s) => s.rounds as number);
  if (rounds.length === 0) return null;
  return rounds.reduce((sum, r) => sum + r, 0) / rounds.length;
}
