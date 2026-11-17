// DSH-5 trends — wireframe Trends structure/classes wired to DSH-2's
// harvestStories output (reuse, no reimplementation). Aggregation lives in
// the pure metrics helpers (AC 6); this component only renders them.
// Nulls -> 'not recorded' titles / 0-height bars, never a fabricated 0.
import { escapedBars, roundsBars, tokensByModel } from '../data/metrics';
import type { ModelMix, TrendBar } from '../data/metrics';
import type { RunLedger, StoryMetrics } from '../data/types';

/** Compact token totals for the mix rows (wireframe shows 7.76M / 3.32M).
 * Pure formatting; non-finite -> 'not recorded' (defense-in-depth). */
export function compactTokens(n: number): string {
  if (!Number.isFinite(n)) return 'not recorded';
  // Trim trailing zeros so round values read "1M" / "1.5M", not "1.00M".
  const trim = (v: number, dp: number) => parseFloat(v.toFixed(dp)).toString();
  if (n >= 1_000_000) return `${trim(n / 1_000_000, 2)}M`;
  if (n >= 1_000) return `${trim(n / 1_000, 1)}k`;
  return String(n);
}

function BarChart({ bars, label, defect }: { bars: TrendBar[]; label: string; defect?: boolean }) {
  // Accessible description exposes every plotted value (incl. 'not recorded')
  // to screen readers — role=img otherwise hides the bars (Copilot DSH-5).
  const desc = bars.map((b) => b.title).join('; ');
  return (
    <div className="dash-bars" role="img" aria-label={label} aria-description={desc}>
      {bars.map((b) => (
        <div key={b.id} className="dash-bar-col" title={b.title}>
          <div className="dash-bar-plot">
            <div
              className={
                'dash-bar'
                + (defect ? ' dash-bar--defect' : '')
                + (b.value == null ? ' dash-bar--null' : '')
              }
              style={{ height: `${b.pct}%` }}
            />
          </div>
          <span className="dash-bar-label">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function MixChart({ mix }: { mix: ModelMix[] }) {
  const desc = mix.map((m) => `${m.model}: ${m.tokens.toLocaleString()} tokens`).join('; ');
  return (
    <div className="dash-mix" role="img" aria-label="Model mix (tokens)" aria-description={desc}>
      {mix.map((m, i) => (
        <div key={m.model} className="dash-mix-row" title={`${m.model}: ${m.tokens.toLocaleString()} tokens`}>
          <span>{m.model}</span>
          <span
            className={'dash-mix-bar' + (i % 2 === 1 ? ' dash-mix-bar--alt' : '')}
            style={{ width: `${m.pct}%` }}
          />
          <span>{compactTokens(m.tokens)}</span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  stories: StoryMetrics[];
  /** Scoped run ledgers — the model-mix source (tokens grouped by row.model). */
  runs: RunLedger[];
}

export default function Trends({ stories, runs }: Props) {
  if (stories.length === 0) {
    return (
      <div className="dash-card">
        <h2 className="dash-title">Trends</h2>
        <p className="dash-empty">No story data in this scope yet.</p>
      </div>
    );
  }
  const rounds = roundsBars(stories);
  const escaped = escapedBars(stories);
  const mix = tokensByModel(runs);
  return (
    <div className="dash-card">
      <h2 className="dash-title">Trends</h2>
      <p className="dash-sub">Review rounds per story (factory arm)</p>
      {rounds.length === 0
        ? <p className="dash-empty">No factory-arm stories in this scope.</p>
        : <BarChart bars={rounds} label="Review rounds per story" />}
      <p className="dash-sub">Escaped defects per story (all arms)</p>
      <BarChart bars={escaped} label="Escaped defects per story" defect />
      <p className="dash-sub">Model mix (tokens)</p>
      {mix.length === 0
        ? <p className="dash-empty">No recorded model usage in this scope.</p>
        : <MixChart mix={mix} />}
      <p className="dash-note">Cycle-time trend deferred to v2 (wall time is in the table).</p>
    </div>
  );
}
