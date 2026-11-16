// DSH-2 fixtures — mirror the real schema-0 ledger/findings shapes
// (factory/ledger.py, state/findings.jsonl). Includes every case the story
// named: correction re-attribution, false-positive / rejected / RESOLVED
// findings, a control-arm run, coder_tokens==0, and missing human_min.
import type { FindingRow, LedgerRow, RunLedger } from './types';

const DEMO = 'demo/factory';
const CTRL = 'demo/control';

function ledger(partial: Partial<LedgerRow> & Pick<LedgerRow, 'event'>): LedgerRow {
  return {
    schema: 0, ts: '2026-11-15T00:00:00Z', story: null, role: null, repo: null,
    sha: null, model: null, tokens: null, cost_usd: null, wall_s: null,
    human_min: null, outcome: null, detail: {}, prev: null, ...partial,
  };
}

function finding(partial: Partial<FindingRow>): FindingRow {
  return {
    ts: '2026-11-15T00:00:00Z', repo: DEMO, pr: 1, round: 1, source: 'copilot',
    klass: 'logic-error', severity: 'major', summary: 'a real defect',
    path: null, head_sha: null, escaped_gate: false, escaped_review: false,
    verified: null, disposition: 'fixed', fix_sha: null, gate_check: null,
    ...partial,
  };
}

// --- factory run: three stories -------------------------------------------
const factoryRows: LedgerRow[] = [
  ledger({ event: 'run_started', role: 'controller', detail: { run: 'demo-run' } }),
  // STY-A: coder dispatch + reviewer dispatch + correction re-attribution.
  ledger({ event: 'dispatch_sealed', story: 'STY-A', role: 'coder', repo: DEMO }),
  ledger({
    event: 'dispatch_completed', story: 'STY-A', role: 'coder', model: 'coder-model',
    tokens: { in: 100, out: 50 }, wall_s: 120, human_min: 2, outcome: 'ok',
  }),
  ledger({
    event: 'dispatch_completed', story: 'STY-A', role: 'reviewer', model: 'review-model',
    tokens: { in: 60, out: 15 }, wall_s: 60, outcome: 'ok',
  }),
  // usage-path-bug recovery: tokens re-attributed to controller (non-coder).
  ledger({
    event: 'correction', story: 'STY-A', role: 'controller',
    detail: { tokens: { in: 200, out: 25 }, cost_usd: 0, reason: 'usage path recovered' },
  }),
  // zero-token correction must not change totals.
  ledger({ event: 'correction', story: 'STY-A', role: 'coder', detail: { tokens: { in: 0, out: 0 } } }),
  ledger({ event: 'human_merged', story: 'STY-A', role: 'human', human_min: 3 }),
  // in-loop finding: counts in defect_found, NOT in escaped defects.
  ledger({ event: 'defect_found', story: 'STY-A', role: 'reviewer', detail: { klass: 'logic-error' } }),
  ledger({ event: 'pr_opened', story: 'STY-A', repo: DEMO, detail: { pr: 1, pre_pr_rounds: 1 } }),
  ledger({ event: 'loop_converged', story: 'STY-A', repo: DEMO, detail: { pr: 1, rounds: 9 } }),
  // STY-B: reviewer-only -> coder_tokens == 0 -> overhead null. No human_min.
  ledger({ event: 'dispatch_sealed', story: 'STY-B', role: 'reviewer', repo: DEMO }),
  ledger({
    event: 'dispatch_completed', story: 'STY-B', role: 'reviewer', model: 'review-model',
    tokens: { in: 90, out: 10 }, wall_s: 30, outcome: 'ok',
  }),
  ledger({ event: 'pr_opened', story: 'STY-B', repo: DEMO, detail: { pr: 2 } }),
  // no findings rows for pr 2 -> rounds fall back to loop_converged.
  ledger({ event: 'loop_converged', story: 'STY-B', repo: DEMO, detail: { pr: 2, rounds: 4 } }),
  // STY-C: missing human_min AND missing wall_s -> null, never 0.
  ledger({ event: 'dispatch_sealed', story: 'STY-C', role: 'coder', repo: DEMO }),
  ledger({
    event: 'dispatch_completed', story: 'STY-C', role: 'coder', model: 'coder-model',
    tokens: { in: 10, out: 5 }, outcome: 'ok',
  }),
  ledger({ event: 'story_done', story: 'STY-C' }),
];

// --- control run: single-pass arm, excluded from mean rounds --------------
const controlRows: LedgerRow[] = [
  ledger({ event: 'run_started', role: 'controller', detail: { arm: 'control' } }),
  ledger({ event: 'dispatch_sealed', story: 'CTL-1', role: 'coder', repo: CTRL }),
  ledger({
    event: 'dispatch_completed', story: 'CTL-1', role: 'coder', model: 'coder-model',
    tokens: { in: 900, out: 100 }, wall_s: 500, outcome: 'ok',
  }),
  // control has no review loop; a rounds value here must NOT enter the mean.
  ledger({ event: 'loop_converged', story: 'CTL-1', repo: CTRL, detail: { rounds: 10 } }),
];

export const factoryRun: RunLedger = { run: 'demo-run', rows: factoryRows };
export const controlRun: RunLedger = { run: 'control-run', rows: controlRows };
export const allRuns: RunLedger[] = [factoryRun, controlRun];

export const findings: FindingRow[] = [
  // STY-A pr 1: pre-PR cross-family round 1 + copilot round 2.
  finding({ source: 'cross-family', round: 1, escaped_gate: true, escaped_review: true }),
  finding({ round: 2, escaped_gate: true, escaped_review: true }),
  // exclusions: false-positive class, rejected disposition, RESOLVED marker.
  finding({ round: 2, klass: 'false-positive', escaped_gate: true, escaped_review: true }),
  finding({ round: 2, disposition: 'rejected', escaped_gate: true, escaped_review: true }),
  finding({ round: 2, summary: 'RESOLVED: marker record, not a defect', escaped_gate: true }),
  // not escaped at all -> excluded.
  finding({ round: 2, summary: 'caught in-loop, never escaped' }),
  // control repo: one genuine escape (post-hoc review, pr 0).
  finding({ repo: CTRL, pr: 0, round: 1, source: 'cross-family', escaped_gate: true, escaped_review: true }),
];

export const REPOS = { demo: DEMO, control: CTRL };
