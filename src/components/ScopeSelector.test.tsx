// DSH-3 scope selector — options are the discovered runs (props), default
// 'all', aria-pressed state, onChange fires with the run id (AC 3/6).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ScopeSelector from './ScopeSelector';

describe('ScopeSelector', () => {
  it('renders all plus the discovered runs as pressed-state buttons', () => {
    render(<ScopeSelector runs={['demo-run', 'control-run']} value="all" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: /select run scope/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'demo-run' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'control-run' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the selected run as pressed', () => {
    render(<ScopeSelector runs={['demo-run']} value="demo-run" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'demo-run' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'all' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the clicked run id', () => {
    const onChange = vi.fn();
    render(<ScopeSelector runs={['demo-run', 'control-run']} value="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'control-run' }));
    expect(onChange).toHaveBeenCalledWith('control-run');
    fireEvent.click(screen.getByRole('button', { name: 'all' }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
