// DSH-2 view models — schema-0 wire shapes (factory/ledger.py, findings.py)
// plus the derived per-story view model. Null means "not recorded", never 0.

export interface LedgerTokens {
  in?: number | null;
  out?: number | null;
}

/** One ledger.jsonl row (schema 0). Fields absent on the wire stay optional. */
export interface LedgerRow {
  event: string;
  schema?: number;
  ts?: string | null;
  story?: string | null;
  role?: string | null;
  repo?: string | null;
  sha?: string | null;
  model?: string | null;
  tokens?: LedgerTokens | null;
  cost_usd?: number | null;
  wall_s?: number | null;
  human_min?: number | null;
  outcome?: string | null;
  detail?: Record<string, unknown> | null;
  prev?: string | null;
}

/** One state/findings.jsonl row. */
export interface FindingRow {
  repo: string;
  pr: number;
  round: number;
  ts?: string | null;
  source?: string | null;
  klass?: string | null;
  severity?: string | null;
  summary?: string | null;
  path?: string | null;
  head_sha?: string | null;
  escaped_gate?: boolean | null;
  escaped_review?: boolean | null;
  verified?: string | null;
  disposition?: string | null;
  fix_sha?: string | null;
  gate_check?: string | null;
}

/** A run's ledger rows, tagged with the run id from GET /api/runs. */
export interface RunLedger {
  run: string;
  rows: LedgerRow[];
}

export type Arm = 'factory' | 'control';

/** Derived per-story metrics (metrics.py harvest semantics + PRD rounds). */
export interface StoryMetrics {
  story: string;
  run: string;
  arm: Arm;
  repo: string | null;
  coderTokens: number;
  noncoderTokens: number;
  /** noncoder/coder; null when coderTokens == 0. */
  overheadRatio: number | null;
  /** null when no dispatch recorded wall time — never 0. */
  wallS: number | null;
  /** null when no human time recorded — never 0. */
  humanMin: number | null;
  /** Raw accumulated cost_usd; a recorded 0 is preserved here. The DISPLAY
      layer (costDisplay) treats null OR 0 as 'not recorded' because cost is
      tokens-only until a price table exists (PRD). */
  costUsd: number | null;
  dispatches: number;
  /** In-loop defect_found events — distinct from escaped defects. */
  inLoopDefects: number;
  /** True when at least one dispatch/correction recorded token usage.
      Distinguishes missing usage (-> 'not recorded') from a recorded zero. */
  tokensRecorded: boolean;
  /** Per-role availability: coder/non-coder buckets tracked separately so a
      story with recorded reviewer usage but missing coder usage shows the
      coder column as 'not recorded', not 0 (Copilot DSH-4). */
  coderTokensRecorded: boolean;
  noncoderTokensRecorded: boolean;
  /** PRD formula (5); null when unrecorded. */
  rounds: number | null;
  /** DSH-4: escaped defects joined on repo+pr (PRD formula 1 per story).
      Null when the findings source failed OR the story has no recorded PR.
      Optional so pre-DSH-4 view-model literals stay valid. */
  escapedDefects?: number | null;
  /** DSH-4: distinct models recorded on the story's dispatches, in first-
      seen order. Empty when no dispatch recorded a model. */
  models?: string[];
}

/** Run/repo scope; 'all' selects everything. */
export interface Scope {
  run: string;
  repo: string;
}
