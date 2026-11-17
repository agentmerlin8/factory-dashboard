// DSH-3 composite — selector ABOVE cards, options discovered from /api/runs,
// scope change recomputes cards, prefs persist, empty/error states (AC 3-5).
// DSH-4 — the per-story table sits below the cards and reacts to scope (AC 4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { controlRun, factoryRun, findings } from './data/fixtures';

function routeFetch(overrides: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    '/api/runs': ['demo-run', 'control-run', 'empty-run'],
    '/api/ledger?run=demo-run': factoryRun.rows,
    '/api/ledger?run=control-run': controlRun.rows,
    '/api/ledger?run=empty-run': [],
    '/api/findings': findings,
    ...overrides,
  };
  return vi.fn(async (url: string) => new Response(
    JSON.stringify(table[url] ?? { error: url + ': no such source' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
}

function cardValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? '';
}

async function loaded() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'demo-run' })).toBeInTheDocument());
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('App composite', () => {
  it('discovers scope options from /api/runs and shows all-scope aggregates', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    expect(screen.getByRole('heading', { name: /factory dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'empty-run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'true');
    expect(cardValue('Total tokens')).toBe('1565');
    expect(cardValue('Escaped defects')).toBe('3');
    expect(cardValue('Mean review rounds')).toBe('3.50');
    expect(cardValue('Overhead ratio')).toBe('0.34');
    expect(cardValue('Cost (USD)')).toBe('not recorded');
  });

  it('recomputes cards when scope changes', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'demo-run' }));
    expect(cardValue('Total tokens')).toBe('565');
    expect(cardValue('Escaped defects')).toBe('2');
    expect(cardValue('Overhead ratio')).toBe('2.42');
    fireEvent.click(screen.getByRole('button', { name: 'control-run' }));
    expect(cardValue('Total tokens')).toBe('1000');
    expect(cardValue('Escaped defects')).toBe('1');
    expect(cardValue('Mean review rounds')).toBe('not recorded');
  });

  it('persists scope across reload via factory-dash:prefs', async () => {
    vi.stubGlobal('fetch', routeFetch());
    const first = render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'control-run' }));
    expect(JSON.parse(localStorage.getItem('factory-dash:prefs') ?? '{}')).toEqual({ run: 'control-run' });
    first.unmount();
    render(<App />);
    await loaded();
    expect(screen.getByRole('button', { name: 'control-run' })).toHaveAttribute('aria-pressed', 'true');
    expect(cardValue('Total tokens')).toBe('1000');
  });

  it('ignores corrupt prefs and defaults to all', async () => {
    localStorage.setItem('factory-dash:prefs', '{not json');
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reconciles a stale saved scope to all (Copilot round-4)', async () => {
    // Saved run no longer exists in discovered runs -> fall back to ALL so
    // data isn't hidden and a scope button stays active.
    localStorage.setItem('factory-dash:prefs', JSON.stringify({ run: 'deleted-run' }));
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'true'));
    // Data is visible (not hidden by the stale scope).
    expect(cardValue('Total tokens')).not.toBe('not recorded');
  });

  it('shows a friendly empty state for a scope with no data, not stale numbers', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'empty-run' }));
    expect(screen.getByText(/no story data in this scope/i)).toBeInTheDocument();
    expect(screen.queryByText('Total tokens')).not.toBeInTheDocument();
  });

  it('shows a per-source error state (file + reason) without crashing', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/findings': { error: 'state/findings.jsonl: permission denied' },
    }));
    render(<App />);
    await loaded();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('state/findings.jsonl: permission denied');
    // Other sources still render; escaped defects unknown, never fabricated.
    expect(cardValue('Total tokens')).toBe('1565');
    expect(cardValue('Escaped defects')).toBe('not recorded');
  });

  it('shows a heading during loading (screen-reader context, F2)', () => {
    // A fetch that never resolves keeps the app in the loading branch.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<App />);
    expect(screen.getByRole('heading', { name: /factory dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/loading factory data/i)).toBeInTheDocument();
  });
});

describe('App per-story table (DSH-4)', () => {
  function tableStoryIds(): string[] {
    const table = screen.getByRole('table');
    return within(table).getAllByRole('row').slice(1)
      .map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');
  }

  it('renders the table below the cards with all stories in scope', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    expect(screen.getByRole('heading', { name: /per-story/i })).toBeInTheDocument();
    expect(tableStoryIds().sort()).toEqual(['CTL-1', 'STY-A', 'STY-B', 'STY-C']);
  });

  it('scope change updates table rows to the selected run only', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'demo-run' }));
    expect(tableStoryIds().sort()).toEqual(['STY-A', 'STY-B', 'STY-C']);
    fireEvent.click(screen.getByRole('button', { name: 'control-run' }));
    expect(tableStoryIds()).toEqual(['CTL-1']);
    fireEvent.click(screen.getByRole('button', { name: 'all' }));
    expect(tableStoryIds().sort()).toEqual(['CTL-1', 'STY-A', 'STY-B', 'STY-C']);
  });

  it('empty scope shows the empty state, not a blank table', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'empty-run' }));
    expect(screen.getByText(/no story data in this scope/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('findings source failed -> escaped cells not recorded, other columns live', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/findings': { error: 'state/findings.jsonl: permission denied' },
    }));
    render(<App />);
    await loaded();
    const row = within(screen.getByRole('table')).getByText('STY-A').closest('tr')!;
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells[6]).toBe('not recorded'); // escaped unknown, never 0
    expect(cells[5]).toBe('9');            // rounds fall back to loop_converged
    expect(cells[2]).toBe('150');          // tokens still render from ledger
  });
});

describe('App trends (DSH-5)', () => {
  function barTitles(label: string): string[] {
    const chart = screen.getByRole('img', { name: label });
    return Array.from(chart.querySelectorAll('.dash-bar')).map((b) => b.getAttribute('title') ?? '');
  }

  it('renders trends below the table with all three charts', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    expect(screen.getByRole('heading', { name: /trends/i })).toBeInTheDocument();
    expect(barTitles('Review rounds per story')).toEqual(['STY-A: 3 rounds', 'STY-B: 4 rounds', 'STY-C: not recorded']);
    expect(barTitles('Escaped defects per story')).toHaveLength(4); // all arms
    const mix = screen.getByRole('img', { name: 'Model mix (tokens)' });
    expect(within(mix).getByText('coder-model')).toBeInTheDocument();
    expect(within(mix).getByText('review-model')).toBeInTheDocument();
  });

  it('scope change updates all three charts to the selected run only', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'control-run' }));
    expect(screen.getByText(/no factory-arm stories/i)).toBeInTheDocument();
    expect(barTitles('Escaped defects per story')).toEqual(['CTL-1 (ctl): not recorded']);
    const mix = screen.getByRole('img', { name: 'Model mix (tokens)' });
    expect(within(mix).queryByText('review-model')).not.toBeInTheDocument();
    expect(within(mix).getByText('1k')).toBeInTheDocument(); // coder-model 1000 tokens
    fireEvent.click(screen.getByRole('button', { name: 'demo-run' }));
    expect(barTitles('Review rounds per story')).toHaveLength(3);
  });

  it('empty scope shows the empty state, not blank charts', async () => {
    vi.stubGlobal('fetch', routeFetch());
    render(<App />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'empty-run' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/no story data in this scope/i)).toBeInTheDocument();
  });

  it('findings source failed -> escaped bars not recorded, rounds + mix live', async () => {
    vi.stubGlobal('fetch', routeFetch({
      '/api/findings': { error: 'state/findings.jsonl: permission denied' },
    }));
    render(<App />);
    await loaded();
    const titles = barTitles('Escaped defects per story');
    expect(titles.every((t) => t.includes('not recorded'))).toBe(true);
    expect(barTitles('Review rounds per story')[0]).toBe('STY-A: 9 rounds'); // loop_converged fallback
  });
});
