/**
 * components/CreatePipelineModal.tsx â€” Modal dialog for creating new pipelines.
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
        workDir: validSteps[0].workDir.trim(),
        stages: validSteps.map((s) => ({
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
              Pipeline Name <span className="text-[#ef4444]">*</span>
            </label>
            <input
              type="text"
              ref={nameRef}
              value={pipelineName}
              onChange={(e) => setPipelineName(e.target.value)}
              placeholder="my-pipeline"
              aria-label="Pipeline Name"
              className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#3b82f6]"
            />
          </div>

          {/* Step column headers */}
          <div className="grid grid-cols-[1fr_120px_1fr_44px] gap-2 text-xs font-medium text-gray-500 px-1">
            <span>Working Directory <span className="text-[#ef4444]">*</span></span>
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
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#3b82f6] font-mono"
                />
                <input
                  type="text"
                  value={step.name}
                  onChange={(e) => updateStep(i, 'name', e.target.value)}
                  placeholder="name"
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#3b82f6]"
                />
                <input
                  type="text"
                  value={step.prompt}
                  onChange={(e) => updateStep(i, 'prompt', e.target.value)}
                  placeholder="Initial prompt..."
                  className="min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#3b82f6]"
                />
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  disabled={steps.length <= 1}
                  aria-label={`Remove step ${i + 1}`}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-[#ef4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
            <div className="text-xs text-[#ef4444] bg-[#ef4444]/10 border border-[#ef4444]/20 rounded px-3 py-2">
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
              className="min-h-[44px] flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded bg-[#3b82f6]/10 hover:bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

