// DSH-3 composite — selector ABOVE cards, options discovered from /api/runs,
// scope change recomputes cards, prefs persist, empty/error states (AC 3-5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
