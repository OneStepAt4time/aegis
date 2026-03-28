# Pipeline Management Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pipelines page to the dashboard with list view, detail view, and create form, exposing the existing pipeline API in the UI.

**Architecture:** Two routes (`/pipelines` list + `/pipelines/:id` detail) following the existing Sessions pattern. Polling via `useEffect`/`setInterval` matching `SessionTable`. Create pipeline via modal matching `CreateSessionModal`. No new dependencies.

**Tech Stack:** React 19, React Router v7, Tailwind CSS v4, Vitest + @testing-library/react

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `dashboard/src/components/pipeline/PipelineStatusBadge.tsx` | Create | Status badge for pipeline states |
| `dashboard/src/components/CreatePipelineModal.tsx` | Create | Modal form to create new pipeline |
| `dashboard/src/pages/PipelinesPage.tsx` | Create | Pipeline list page |
| `dashboard/src/pages/PipelineDetailPage.tsx` | Create | Pipeline detail page |
| `dashboard/src/App.tsx` | Modify | Add routes |
| `dashboard/src/components/Layout.tsx` | Modify | Activate sidebar nav |
| `dashboard/src/__tests__/PipelineStatusBadge.test.tsx` | Create | Badge tests |
| `dashboard/src/__tests__/CreatePipelineModal.test.tsx` | Create | Modal tests |
| `dashboard/src/__tests__/PipelinesPage.test.tsx` | Create | List page tests |
| `dashboard/src/__tests__/PipelineDetailPage.test.tsx` | Create | Detail page tests |

---

### Task 1: PipelineStatusBadge component + tests

**Files:**
- Create: `dashboard/src/components/pipeline/PipelineStatusBadge.tsx`
- Create: `dashboard/src/__tests__/PipelineStatusBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// dashboard/src/__tests__/PipelineStatusBadge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PipelineStatusBadge from '../components/pipeline/PipelineStatusBadge';

describe('PipelineStatusBadge', () => {
  it('renders running status with cyan color', () => {
    render(<PipelineStatusBadge status="running" />);
    const badge = screen.getByText('running');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-cyan');
  });

  it('renders completed status with green color', () => {
    render(<PipelineStatusBadge status="completed" />);
    const badge = screen.getByText('completed');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-emerald-400');
  });

  it('renders failed status with red color', () => {
    render(<PipelineStatusBadge status="failed" />);
    const badge = screen.getByText('failed');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-red-400');
  });

  it('renders unknown status with gray color', () => {
    render(<PipelineStatusBadge status="something_else" />);
    const badge = screen.getByText('something_else');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-gray-500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run dashboard/src/__tests__/PipelineStatusBadge.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// dashboard/src/components/pipeline/PipelineStatusBadge.tsx
/**
 * components/pipeline/PipelineStatusBadge.tsx — Status badge for pipeline states.
 */

interface PipelineStatusBadgeProps {
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-cyan/10 text-cyan border-cyan/30',
  completed: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/30',
  failed: 'bg-red-400/10 text-red-400 border-red-400/30',
  pending: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

const PULSE_STATUSES = new Set(['running']);

export default function PipelineStatusBadge({ status }: PipelineStatusBadgeProps) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-500/10 text-gray-500 border-gray-500/30';
  const shouldPulse = PULSE_STATUSES.has(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles}`}
    >
      {shouldPulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      {status}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run dashboard/src/__tests__/PipelineStatusBadge.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/pipeline/PipelineStatusBadge.tsx dashboard/src/__tests__/PipelineStatusBadge.test.tsx
git commit -m "feat(dashboard): add PipelineStatusBadge component"
```

---

### Task 2: CreatePipelineModal component + tests

**Files:**
- Create: `dashboard/src/components/CreatePipelineModal.tsx`
- Create: `dashboard/src/__tests__/CreatePipelineModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// dashboard/src/__tests__/CreatePipelineModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreatePipelineModal from '../components/CreatePipelineModal';

const mockCreatePipeline = vi.fn();

vi.mock('../api/client', () => ({
  createPipeline: (...args: unknown[]) => mockCreatePipeline(...args),
}));

function renderModal(open = true, onClose = vi.fn()): void {
  render(
    <MemoryRouter>
      <CreatePipelineModal open={open} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe('CreatePipelineModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when closed', () => {
    renderModal(false);
    expect(screen.queryByText('New Pipeline')).toBeNull();
  });

  it('renders form with pipeline name input when open', () => {
    renderModal();
    expect(screen.getByLabelText('Pipeline Name')).toBeDefined();
  });

  it('shows two step rows by default', () => {
    renderModal();
    const inputs = screen.getAllByPlaceholderText('/home/user/project');
    expect(inputs).toHaveLength(2);
  });

  it('adds a step when "Add Step" is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByText('Add Step'));
    const inputs = screen.getAllByPlaceholderText('/home/user/project');
    expect(inputs).toHaveLength(3);
  });

  it('removes a step when trash button is clicked', () => {
    renderModal();
    const inputs = screen.getAllByPlaceholderText('/home/user/project');
    expect(inputs).toHaveLength(2);
    // Click first delete button
    const deleteButtons = screen.getAllByRole('button', { name: '' });
    // Find trash buttons (they have no accessible name, use test more carefully)
    fireEvent.click(screen.getByLabelText('Remove step 1'));
    expect(screen.getAllByPlaceholderText('/home/user/project')).toHaveLength(1);
  });

  it('disables submit when pipeline name is empty', () => {
    renderModal();
    const submitBtn = screen.getByRole('button', { name: /Create Pipeline/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('enables submit when pipeline name and at least one workDir are filled', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Pipeline Name'), { target: { value: 'Test Pipeline' } });
    const workDirInputs = screen.getAllByPlaceholderText('/home/user/project');
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });

    const submitBtn = screen.getByRole('button', { name: /Create Pipeline/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('calls createPipeline and navigates on submit', async () => {
    const mockPipeline = {
      id: 'pipe-123',
      name: 'Test Pipeline',
      status: 'pending',
      sessions: [],
      createdAt: new Date().toISOString(),
    };
    mockCreatePipeline.mockResolvedValueOnce(mockPipeline);

    renderModal();
    fireEvent.change(screen.getByLabelText('Pipeline Name'), { target: { value: 'Test Pipeline' } });
    const workDirInputs = screen.getAllByPlaceholderText('/home/user/project');
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Pipeline/i }));

    await waitFor(() => {
      expect(mockCreatePipeline).toHaveBeenCalledTimes(1);
    });

    const callArg = mockCreatePipeline.mock.calls[0][0] as {
      name: string;
      sessions: Array<{ workDir: string }>;
    };
    expect(callArg.name).toBe('Test Pipeline');
    expect(callArg.sessions).toHaveLength(1);
    expect(callArg.sessions[0].workDir).toBe('/home/user/proj-a');
  });

  it('shows error message on failure', async () => {
    mockCreatePipeline.mockRejectedValueOnce(new Error('Server error'));

    renderModal();
    fireEvent.change(screen.getByLabelText('Pipeline Name'), { target: { value: 'Test Pipeline' } });
    const workDirInputs = screen.getAllByPlaceholderText('/home/user/project');
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Pipeline/i }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run dashboard/src/__tests__/CreatePipelineModal.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// dashboard/src/components/CreatePipelineModal.tsx
/**
 * components/CreatePipelineModal.tsx — Modal dialog for creating new pipelines.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, Plus, Trash2 } from 'lucide-react';
import { createPipeline } from '../api/client';

interface CreatePipelineModalProps {
  open: boolean;
  onClose: () => void;
}

interface StepRow {
  workDir: string;
  name: string;
  prompt: string;
  _key: number;
}

let nextKey = 0;
function makeStep(): StepRow {
  return { workDir: '', name: '', prompt: '', _key: nextKey++ };
}

export default function CreatePipelineModal({ open, onClose }: CreatePipelineModalProps) {
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [pipelineName, setPipelineName] = useState('');
  const [steps, setSteps] = useState<StepRow[]>([makeStep(), makeStep()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback((): void => {
    resetForm();
    onClose();
  }, [onClose]);

  function resetForm(): void {
    setPipelineName('');
    setSteps([makeStep(), makeStep()]);
    setLoading(false);
    setError(null);
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  // Focus trap
  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    if (!modal) return;
    const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    modal.addEventListener('keydown', handler);
    return () => modal.removeEventListener('keydown', handler);
  }, [open]);

  // Focus first input
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => nameRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  function addStep(): void {
    if (steps.length >= 10) return;
    setSteps([...steps, makeStep()]);
  }

  function removeStep(index: number): void {
    if (steps.length <= 1) return;
    setSteps(steps.filter((_, i) => i !== index));
  }

  function updateStep(index: number, field: keyof StepRow, value: string): void {
    setSteps(steps.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    const validSteps = steps.filter((s) => s.workDir.trim());
    if (!pipelineName.trim()) {
      setError('Pipeline name is required');
      return;
    }
    if (validSteps.length === 0) {
      setError('At least one step with a working directory is required');
      return;
    }

    setLoading(true);
    try {
      const result = await createPipeline({
        name: pipelineName.trim(),
        sessions: validSteps.map((s) => ({
          workDir: s.workDir.trim(),
          name: s.name.trim() || undefined,
          prompt: s.prompt.trim() || undefined,
        })),
      });
      resetForm();
      onClose();
      navigate(`/pipelines/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pipeline');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const canSubmit = pipelineName.trim() && steps.some((s) => s.workDir.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Create new pipeline" className="relative w-full max-w-2xl mx-4 bg-[#111118] border border-[#1a1a2e] rounded-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[#1a1a2e]">
          <h2 className="text-sm font-semibold text-gray-100">New Pipeline</h2>
          <button
            onClick={handleClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {/* Pipeline Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Pipeline Name <span className="text-[#ff3366]">*</span>
            </label>
            <input
              type="text"
              ref={nameRef}
              value={pipelineName}
              onChange={(e) => setPipelineName(e.target.value)}
              placeholder="my-pipeline"
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff]"
            />
          </div>

          {/* Step column headers */}
          <div className="grid grid-cols-[1fr_120px_1fr_44px] gap-2 text-xs font-medium text-gray-500 px-1">
            <span>Working Directory <span className="text-[#ff3366]">*</span></span>
            <span>Name</span>
            <span>Prompt</span>
            <span />
          </div>

          {/* Steps */}
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={step._key} className="grid grid-cols-[1fr_120px_1fr_44px] gap-2 items-start">
                <input
                  type="text"
                  value={step.workDir}
                  onChange={(e) => updateStep(i, 'workDir', e.target.value)}
                  placeholder="/home/user/project"
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff] font-mono"
                />
                <input
                  type="text"
                  value={step.name}
                  onChange={(e) => updateStep(i, 'name', e.target.value)}
                  placeholder="name"
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff]"
                />
                <input
                  type="text"
                  value={step.prompt}
                  onChange={(e) => updateStep(i, 'prompt', e.target.value)}
                  placeholder="Initial prompt..."
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff]"
                />
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  disabled={steps.length <= 1}
                  aria-label={`Remove step ${i + 1}`}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-[#ff3366] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add step */}
          {steps.length < 10 && (
            <button
              type="button"
              onClick={addStep}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Step
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-[#ff3366] bg-[#ff3366]/10 border border-[#ff3366]/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              Create Pipeline
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run dashboard/src/__tests__/CreatePipelineModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/CreatePipelineModal.tsx dashboard/src/__tests__/CreatePipelineModal.test.tsx
git commit -m "feat(dashboard): add CreatePipelineModal component"
```

---

### Task 3: PipelinesPage component + tests

**Files:**
- Create: `dashboard/src/pages/PipelinesPage.tsx`
- Create: `dashboard/src/__tests__/PipelinesPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// dashboard/src/__tests__/PipelinesPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PipelinesPage from '../pages/PipelinesPage';
import type { PipelineInfo } from '../api/client';

const mockGetPipelines = vi.fn();

vi.mock('../api/client', () => ({
  getPipelines: (...args: unknown[]) => mockGetPipelines(...args),
}));

function renderPage(): void {
  render(
    <MemoryRouter>
      <PipelinesPage />
    </MemoryRouter>,
  );
}

const mockPipelines: PipelineInfo[] = [
  {
    id: 'pipe-1',
    name: 'Build Pipeline',
    status: 'running',
    sessions: [
      { id: 's1', status: 'completed' } as PipelineInfo['sessions'][0],
      { id: 's2', status: 'working' } as PipelineInfo['sessions'][0],
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'pipe-2',
    name: 'Test Pipeline',
    status: 'completed',
    sessions: [],
    createdAt: new Date().toISOString(),
  },
];

describe('PipelinesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPipelines.mockResolvedValue([]);
  });

  it('renders the Pipelines heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Pipelines')).toBeDefined();
    });
  });

  it('shows empty state when no pipelines exist', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No pipelines yet')).toBeDefined();
    });
  });

  it('renders pipeline list after fetch', async () => {
    mockGetPipelines.mockResolvedValue(mockPipelines);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Build Pipeline')).toBeDefined();
      expect(screen.getByText('Test Pipeline')).toBeDefined();
    });
  });

  it('shows pipeline status badges', async () => {
    mockGetPipelines.mockResolvedValue(mockPipelines);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('running')).toBeDefined();
      expect(screen.getByText('completed')).toBeDefined();
    });
  });

  it('opens create modal when New Pipeline button is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Pipelines')).toBeDefined();
    });
    fireEvent.click(screen.getByText('New Pipeline'));
    // Modal should render
    expect(screen.getByText('New Pipeline', { selector: 'h2' })).toBeDefined();
  });

  it('shows metric cards with pipeline counts', async () => {
    mockGetPipelines.mockResolvedValue(mockPipelines);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Total')).toBeDefined();
      expect(screen.getByText('Running')).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run dashboard/src/__tests__/PipelinesPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// dashboard/src/pages/PipelinesPage.tsx
/**
 * pages/PipelinesPage.tsx — Pipeline list with metrics and create action.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { getPipelines } from '../api/client';
import type { PipelineInfo } from '../api/client';
import { useToastStore } from '../store/useToastStore';
import { formatTimeAgo } from '../utils/format';
import MetricCard from '../components/overview/MetricCard';
import PipelineStatusBadge from '../components/pipeline/PipelineStatusBadge';
import CreatePipelineModal from '../components/CreatePipelineModal';

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const addToast = useToastStore((t) => t.addToast);

  const fetchPipelines = useCallback(async () => {
    try {
      const data = await getPipelines();
      setPipelines(data);
    } catch (e: unknown) {
      addToast('error', 'Failed to fetch pipelines', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchPipelines();
    const interval = setInterval(fetchPipelines, 5_000);
    return () => clearInterval(interval);
  }, [fetchPipelines]);

  const counts = {
    total: pipelines.length,
    running: pipelines.filter((p) => p.status === 'running').length,
    completed: pipelines.filter((p) => p.status === 'completed').length,
    failed: pipelines.filter((p) => p.status === 'failed').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500 text-sm">
        <div className="animate-pulse">Loading pipelines…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Pipelines</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage and monitor session pipelines
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Pipeline
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total" value={counts.total} />
        <MetricCard label="Running" value={counts.running} />
        <MetricCard label="Completed" value={counts.completed} />
        <MetricCard label="Failed" value={counts.failed} />
      </div>

      {/* Pipeline List */}
      {pipelines.length === 0 ? (
        <div className="rounded-lg border border-void-lighter bg-[#111118] p-12 text-center">
          <p className="text-gray-500">No pipelines yet</p>
          <p className="mt-1 text-xs text-gray-600">Create a pipeline to run sessions in sequence</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map((pipeline) => (
            <Link
              key={pipeline.id}
              to={`/pipelines/${pipeline.id}`}
              className="block rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 hover:border-[#00e5ff]/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-gray-200 truncate">
                    {pipeline.name}
                  </span>
                  <PipelineStatusBadge status={pipeline.status} />
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0 ml-4">
                  <span>{pipeline.sessions.length} step{pipeline.sessions.length !== 1 ? 's' : ''}</span>
                  <span>{formatTimeAgo(new Date(pipeline.createdAt).getTime())}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreatePipelineModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run dashboard/src/__tests__/PipelinesPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/PipelinesPage.tsx dashboard/src/__tests__/PipelinesPage.test.tsx
git commit -m "feat(dashboard): add PipelinesPage component"
```

---

### Task 4: PipelineDetailPage component + tests

**Files:**
- Create: `dashboard/src/pages/PipelineDetailPage.tsx`
- Create: `dashboard/src/__tests__/PipelineDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// dashboard/src/__tests__/PipelineDetailPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PipelineDetailPage from '../pages/PipelineDetailPage';
import type { PipelineInfo } from '../api/client';

const mockGetPipeline = vi.fn();

vi.mock('../api/client', () => ({
  getPipeline: (...args: unknown[]) => mockGetPipeline(...args),
}));

const mockPipeline: PipelineInfo = {
  id: 'pipe-1',
  name: 'Build Pipeline',
  status: 'running',
  sessions: [
    {
      id: 's1',
      windowId: 'w1',
      windowName: 'step-1',
      workDir: '/home/user/project-a',
      status: 'completed',
      createdAt: Date.now() - 3600000,
      lastActivity: Date.now() - 600000,
      byteOffset: 0,
      monitorOffset: 0,
      stallThresholdMs: 300000,
      permissionMode: 'default',
    },
    {
      id: 's2',
      windowId: 'w2',
      windowName: 'step-2',
      workDir: '/home/user/project-b',
      status: 'working',
      createdAt: Date.now() - 1800000,
      lastActivity: Date.now(),
      byteOffset: 0,
      monitorOffset: 0,
      stallThresholdMs: 300000,
      permissionMode: 'default',
    },
  ],
  createdAt: new Date().toISOString(),
};

function renderPage(id = 'pipe-1'): void {
  render(
    <MemoryRouter initialEntries={[`/pipelines/${id}`]}>
      <Routes>
        <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PipelineDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pipeline name and status', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Build Pipeline')).toBeDefined();
      expect(screen.getByText('running')).toBeDefined();
    });
  });

  it('renders session steps in table', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('step-1')).toBeDefined();
      expect(screen.getByText('step-2')).toBeDefined();
    });
  });

  it('renders step order numbers', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('#1')).toBeDefined();
      expect(screen.getByText('#2')).toBeDefined();
    });
  });

  it('shows 404 state when pipeline not found', async () => {
    const err = new Error('Not found') as Error & { statusCode: number };
    err.statusCode = 404;
    mockGetPipeline.mockRejectedValue(err);
    renderPage('nonexistent');
    await waitFor(() => {
      expect(screen.getByText('Pipeline not found')).toBeDefined();
    });
  });

  it('renders breadcrumb back to Pipelines', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      const backLink = screen.getByText('Pipelines');
      expect(backLink).toBeDefined();
      expect(backLink.closest('a')?.getAttribute('href')).toBe('/pipelines');
    });
  });

  it('renders workDir for each session step', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('/home/user/project-a')).toBeDefined();
      expect(screen.getByText('/home/user/project-b')).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run dashboard/src/__tests__/PipelineDetailPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// dashboard/src/pages/PipelineDetailPage.tsx
/**
 * pages/PipelineDetailPage.tsx — Pipeline detail with session step table.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPipeline } from '../api/client';
import type { PipelineInfo } from '../api/client';
import { useToastStore } from '../store/useToastStore';
import { formatTimeAgo } from '../utils/format';
import PipelineStatusBadge from '../components/pipeline/PipelineStatusBadge';
import StatusDot from '../components/overview/StatusDot';

export default function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pipeline, setPipeline] = useState<PipelineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const addToast = useToastStore((t) => t.addToast);

  const fetchPipeline = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getPipeline(id);
      setPipeline(data);
      setNotFound(false);
    } catch (e: unknown) {
      const err = e as Error & { statusCode?: number };
      if (err.statusCode === 404) {
        setNotFound(true);
      } else {
        addToast('error', 'Failed to fetch pipeline', err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [id, addToast]);

  useEffect(() => {
    fetchPipeline();
    const interval = setInterval(fetchPipeline, 3_000);
    return () => clearInterval(interval);
  }, [fetchPipeline]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500 text-sm">
        <div className="animate-pulse">Loading pipeline…</div>
      </div>
    );
  }

  if (notFound || !pipeline) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-gray-500">
        <div className="text-6xl mb-4">404</div>
        <div className="text-lg mb-6 text-gray-200">Pipeline not found</div>
        <Link to="/pipelines" className="text-sm text-[#00e5ff] hover:underline">
          ← Back to Pipelines
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-500 flex items-center gap-1">
        <Link to="/pipelines" className="hover:text-[#00e5ff] transition-colors">
          Pipelines
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-200 truncate max-w-xs">
          {pipeline.name}
        </span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-100">{pipeline.name}</h2>
          <PipelineStatusBadge status={pipeline.status} />
        </div>
        <div className="text-xs text-gray-500">
          Created {formatTimeAgo(new Date(pipeline.createdAt).getTime())}
        </div>
      </div>

      {/* Steps Table */}
      <div className="rounded-lg border border-void-lighter bg-[#111118]">
        <div className="px-4 py-3 border-b border-void-lighter">
          <h3 className="text-sm font-semibold text-gray-200">
            Steps ({pipeline.sessions.length})
          </h3>
        </div>
        {pipeline.sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No steps yet
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-void-lighter text-gray-600">
                <th className="px-4 py-3 font-medium w-16">#</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">WorkDir</th>
                <th className="px-4 py-3 font-medium">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.sessions.map((session, i) => (
                <tr
                  key={session.id}
                  className="border-b border-void-lighter/50 transition-colors hover:border-l-2 hover:border-l-cyan"
                >
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                    #{i + 1}
                  </td>
                  <td className="px-4 py-3">
                    <StatusDot status={session.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/sessions/${encodeURIComponent(session.id)}`}
                      className="font-medium text-gray-200 hover:text-cyan transition-colors"
                    >
                      {session.windowName || session.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate font-mono text-xs text-gray-400" title={session.workDir}>
                    {session.workDir}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-400">
                    {formatTimeAgo(session.lastActivity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run dashboard/src/__tests__/PipelineDetailPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/PipelineDetailPage.tsx dashboard/src/__tests__/PipelineDetailPage.test.tsx
git commit -m "feat(dashboard): add PipelineDetailPage component"
```

---

### Task 5: Wire up routing and sidebar

**Files:**
- Modify: `dashboard/src/App.tsx` (add pipeline routes)
- Modify: `dashboard/src/components/Layout.tsx` (activate sidebar nav)

- [ ] **Step 1: Update App.tsx — add imports and routes**

Add imports after the existing imports at lines 8-9:

```tsx
import PipelinesPage from './pages/PipelinesPage';
import PipelineDetailPage from './pages/PipelineDetailPage';
```

Add routes inside the `<Route element={<Layout />}>` block, after the sessions route (line 17):

```tsx
          <Route path="/pipelines" element={<PipelinesPage />} />
          <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
```

The full App.tsx should be:

```tsx
/**
 * App.tsx — Root component with React Router.
 */

import { Routes, Route } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import OverviewPage from './pages/OverviewPage';
import SessionDetailPage from './pages/SessionDetailPage';
import PipelinesPage from './pages/PipelinesPage';
import PipelineDetailPage from './pages/PipelineDetailPage';

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/pipelines" element={<PipelinesPage />} />
          <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 2: Update Layout.tsx — activate Pipelines sidebar nav**

Change `NAV_ITEMS` (line 17-19) from:

```tsx
const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
];
```

to:

```tsx
const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/pipelines', label: 'Pipelines', icon: Activity },
];
```

Remove the Pipelines placeholder from the placeholder div (lines 94-97). The remaining placeholder should only contain Sessions:

```tsx
          {/* Placeholder nav items */}
          <div className="mt-4 border-t border-void-lighter pt-4 opacity-40">
            <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-500">
              <Terminal className="h-4 w-4" />
              Sessions
            </div>
          </div>
```

Note: The `Terminal` import is no longer needed if Sessions also becomes a real nav item later, but for now keep it since Sessions is still a placeholder. The `Activity` icon is already imported and now used in `NAV_ITEMS`.

- [ ] **Step 3: Run type-check and all tests**

Run: `npx tsc --noEmit && npx vitest run dashboard/src/__tests__/`
Expected: All tests pass, no type errors

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/App.tsx dashboard/src/components/Layout.tsx
git commit -m "feat(dashboard): wire up pipeline routes and sidebar nav"
```

---

### Task 6: Run full test suite and type-check

**Files:** None (verification only)

- [ ] **Step 1: Run full type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all dashboard tests**

Run: `npx vitest run dashboard/src/__tests__/`
Expected: All tests pass

- [ ] **Step 3: Run full project test suite**

Run: `npm test`
Expected: All tests pass (both backend and dashboard)

- [ ] **Step 4: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors
