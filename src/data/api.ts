// DSH-2 API client — typed fetch/parse of the three read-only endpoints.
// Every failure mode (network, HTTP status, malformed JSON, per-source
// {error} payload, wrong shape) becomes a typed {error} result; these
// functions never throw and never fabricate rows.
import type { FindingRow, LedgerRow } from './types';

export type ApiResult<T> = { rows: T } | { error: string };

async function getJson(url: string): Promise<ApiResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    return { error: url + ': ' + (err instanceof Error ? err.message : String(err)) };
  }
  if (!response.ok) {
    return { error: url + ': HTTP ' + response.status };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return { error: url + ': invalid JSON: ' + (err instanceof Error ? err.message : String(err)) };
  }
  // Per-source error payload from the data server: 200 {"error": "<file>: <reason>"}.
  if (body !== null && typeof body === 'object' && !Array.isArray(body)
    && typeof (body as { error?: unknown }).error === 'string') {
    return { error: (body as { error: string }).error };
  }
  return { rows: body };
}

function asArray<T>(result: ApiResult<unknown>, url: string, guard: (v: unknown) => v is T): ApiResult<T[]> {
  if ('error' in result) return result;
  const rows = result.rows;
  if (!Array.isArray(rows) || !rows.every(guard)) {
    return { error: url + ': unexpected payload shape (expected an array of rows)' };
  }
  return { rows: rows as T[] };
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
// Optional-field validators: absent/null is fine; a PRESENT value must have
// the right type, or malformed source data silently corrupts aggregates
// (Copilot DSH-2 round-1: tokens {in:"100"} -> string concat; summary:42 ->
// TypeError in isEscapedDefect).
const optNumber = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));
const optString = (v: unknown): boolean => v === undefined || v === null || typeof v === 'string';
const optBoolean = (v: unknown): boolean => v === undefined || v === null || typeof v === 'boolean';
const isTokens = (v: unknown): boolean =>
  v === undefined || v === null || (isRecord(v) && optNumber(v.in) && optNumber(v.out));
// Correction usage lives in detail.tokens / detail.cost_usd; round metadata
// lives in detail.pr / detail.rounds / detail.pre_pr_rounds. Validate ALL
// known numeric detail keys at the boundary so malformed values are a typed
// source error, not silently dropped downstream (Copilot DSH-2 rounds 3/8 —
// close the form space, not one field at a time).
const DETAIL_NUMERIC_KEYS = ['cost_usd', 'pr', 'rounds', 'pre_pr_rounds'] as const;
const isDetail = (v: unknown): boolean =>
  v === undefined || v === null || (isRecord(v) && isTokens(v.tokens)
    && DETAIL_NUMERIC_KEYS.every((k) => optNumber(v[k])));
const isLedgerRow = (v: unknown): v is LedgerRow =>
  isRecord(v) && typeof v.event === 'string'
  && isTokens(v.tokens) && optNumber(v.cost_usd) && optNumber(v.wall_s)
  && optNumber(v.human_min) && optString(v.story) && optString(v.role)
  && optString(v.repo) && optString(v.model) && optString(v.outcome)
  && isDetail(v.detail);
const isFindingRow = (v: unknown): v is FindingRow =>
  isRecord(v) && typeof v.repo === 'string'
  && typeof v.pr === 'number' && Number.isFinite(v.pr)
  && typeof v.round === 'number' && Number.isFinite(v.round)
  && optString(v.summary) && optString(v.klass) && optString(v.disposition)
  && optString(v.source) && optString(v.severity) && optString(v.verified)
  && optBoolean(v.escaped_gate) && optBoolean(v.escaped_review);

export async function fetchRuns(): Promise<ApiResult<string[]>> {
  const url = '/api/runs';
  return asArray(await getJson(url), url, isString);
}

export async function fetchLedger(run: string): Promise<ApiResult<LedgerRow[]>> {
  const url = '/api/ledger?run=' + encodeURIComponent(run);
  return asArray(await getJson(url), url, isLedgerRow);
}

export async function fetchFindings(): Promise<ApiResult<FindingRow[]>> {
  const url = '/api/findings';
  return asArray(await getJson(url), url, isFindingRow);
}
