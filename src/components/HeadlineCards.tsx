// DSH-3 headline cards — wireframe structure/classes wired to DSH-2's
// aggregate functions (formulas single-sourced, AC 1). Missing data renders
// 'not recorded', never 0; cost 0/null is unknown (AC 2, costDisplay).
import { headlineOverhead, meanReviewRounds } from '../data/metrics';
import { costDisplay, fmt } from '../data/format';
import type { StoryMetrics } from '../data/types';

interface Props {
  stories: StoryMetrics[];
  /** null when the findings source failed — unknown, not 0. */
  escapedDefects: number | null;
  sub?: string;
}

export default function HeadlineCards({ stories, escapedDefects, sub }: Props) {
  const totalTokens = stories.reduce((sum, s) => sum + s.coderTokens + s.noncoderTokens, 0);
  // Zero tokens is only real when usage was actually recorded.
  const tokensRecorded = totalTokens > 0 || stories.some((s) => s.dispatches > 0);
  const costs = stories.map((s) => s.costUsd).filter((c): c is number => c != null);
  const totalCost = costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null;
  const cards = [
    { label: 'Total tokens', value: tokensRecorded ? fmt(totalTokens) : 'not recorded' },
    { label: 'Cost (USD)', value: costDisplay(totalCost) },
    { label: 'Escaped defects', value: fmt(escapedDefects) },
    { label: 'Mean review rounds', value: fmt(meanReviewRounds(stories)) },
    { label: 'Overhead ratio', value: fmt(headlineOverhead(stories)) },
  ];
  return (
    <div className="dash-card">
      <h1 className="dash-title">Factory dashboard</h1>
      {sub ? <p className="dash-sub">{sub}</p> : null}
      <div className="dash-cards">
        {cards.map((c) => (
          <div key={c.label} className="dash-stat">
            <span className="dash-stat-label">{c.label}</span>
            <span className="dash-stat-value">{c.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
