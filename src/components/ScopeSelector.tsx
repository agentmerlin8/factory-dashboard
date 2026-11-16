// DSH-3 scope selector — wireframe structure/classes; options are the runs
// discovered from GET /api/runs (passed in), never hardcoded (AC 3).
import { ALL } from '../data/metrics';

interface Props {
  runs: string[];
  value: string;
  onChange: (run: string) => void;
}

export default function ScopeSelector({ runs, value, onChange }: Props) {
  return (
    <div className="dash-card">
      <h2 className="dash-title">Scope</h2>
      <div className="dash-filters" role="group" aria-label="Select run scope">
        {[ALL, ...runs].map((run) => (
          <button
            key={run}
            className="dash-filter"
            aria-pressed={value === run}
            onClick={() => onChange(run)}
          >
            {run}
          </button>
        ))}
      </div>
    </div>
  );
}
