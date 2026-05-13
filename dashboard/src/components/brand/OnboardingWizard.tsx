/**
 * pages/OnboardingPage.tsx — Multi-step first-run onboarding wizard.
 * Shows on first authenticated visit. Stores completion in localStorage.
 *
 * Steps:
 *  1. Welcome — Aegis branding + intro
 *  2. Connect — guide user to run `ag init` or connect CC session
 *  3. First Session — walk through creating a session
 *  4. Explore — highlight key dashboard pages
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Rocket,
  Terminal,
  Play,
  Compass,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  X,
} from 'lucide-react';

const TOTAL_STEPS = 4;

const STEPS = [
  {
    id: 1,
    icon: Rocket,
    title: 'Welcome to Aegis',
    description:
      'Your Claude Code orchestration hub. Monitor sessions, manage permissions, and track costs — all from one dashboard.',
  },
  {
    id: 2,
    icon: Terminal,
    title: 'Connect Your Environment',
    description:
      'Run the CLI init command to connect your Claude Code sessions to Aegis. Copy the snippet below and paste it into your terminal.',
    snippet: 'npx @anthropic-ai/claude-code@latest && ag init',
  },
  {
    id: 3,
    icon: Play,
    title: 'Create Your First Session',
    description:
      'Once connected, create a new Claude Code session from the dashboard. Aegis will handle permissions, audit logging, and real-time monitoring automatically.',
  },
  {
    id: 4,
    icon: Compass,
    title: 'Explore the Dashboard',
    description:
      'You\'re all set! Key pages to check out:\n\n• Sessions — live session monitoring and history\n• Analytics — usage metrics and agent contributions\n• Cost — token tracking and budget alerts\n• Settings — configure preferences and API keys',
  },
] as const;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent-cyan)] px-3 py-1.5 text-xs font-medium text-[var(--color-void-dark)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
      aria-label={copied ? 'Copied to clipboard' : 'Copy command to clipboard'}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </>
      )}
    </button>
  );
}

function StepContent({
  step,
}: {
  step: (typeof STEPS)[number];
}) {
  const Icon = step.icon;

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent-cyan)]/10 ring-1 ring-[var(--color-accent-cyan)]/20"
        aria-hidden="true"
      >
        <Icon className="h-8 w-8 text-[var(--color-accent-cyan)]" />
      </div>
      <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
        {step.title}
      </h2>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--color-text-muted)] whitespace-pre-line">
        {step.description}
      </p>
      {'snippet' in step && step.snippet && (
        <div className="mt-6 w-full max-w-md">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-void-dark)] p-3">
            <code className="flex-1 overflow-x-auto text-left text-xs font-mono text-[var(--color-accent-cyan)]">
              {step.snippet}
            </code>
            <CopyButton text={step.snippet} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-label={`Step ${current} of ${TOTAL_STEPS}`}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === current;
        const isComplete = stepNum < current;

        return (
          <div key={stepNum} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                isActive
                  ? 'bg-[var(--color-accent-cyan)] text-[var(--color-void-dark)]'
                  : isComplete
                    ? 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]'
                    : 'bg-[var(--color-surface-strong)] text-[var(--color-text-muted)]'
              }`}
              aria-current={isActive ? 'step' : undefined}
            >
              {isComplete ? <Check className="h-4 w-4" /> : stepNum}
            </div>
            {stepNum < TOTAL_STEPS && (
              <div
                className={`h-0.5 w-8 rounded transition-colors ${
                  isComplete
                    ? 'bg-[var(--color-accent-cyan)]'
                    : 'bg-[var(--color-border-strong)]'
                }`}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface OnboardingWizardProps {
  onComplete: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const step = STEPS[currentStep - 1];

  const isLastStep = currentStep === TOTAL_STEPS;

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
    }
  }, [isLastStep, onComplete]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 1));
  }, []);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
      if (e.key === 'ArrowLeft') handleBack();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleNext, handleBack]);

  // Announce step changes to screen readers
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(`Step ${currentStep} of ${TOTAL_STEPS}: ${step.title}`);
  }, [currentStep, step.title]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-void-dark)] p-6"
      role="region"
      aria-label="Onboarding wizard"
      aria-live="polite"
    >
      {/* Screen reader announcement */}
      <div className="sr-only" aria-live="assertive" role="status">
        {announcement}
      </div>

      {/* Skip button — top right */}
      <button
        type="button"
        onClick={handleSkip}
        className="absolute right-4 top-4 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)]"
        aria-label="Skip onboarding"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Wizard card */}
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-8 shadow-2xl">
        {/* Progress */}
        <div className="mb-8 flex justify-center">
          <ProgressIndicator current={currentStep} />
        </div>

        {/* Step content */}
        <div className="mb-8 min-h-[240px] flex items-center">
          <StepContent step={step} />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 1}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)]"
            aria-label="Go to previous step"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          <button
            type="button"
            onClick={handleSkip}
            className="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)]"
          >
            Skip tour
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[var(--color-accent-cyan)] px-4 py-2 text-sm font-bold text-[var(--color-void-dark)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
            aria-label={isLastStep ? 'Complete onboarding and go to dashboard' : 'Go to next step'}
          >
            {isLastStep ? 'Get Started' : 'Next'}
            {!isLastStep && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Footer branding */}
      <p className="mt-6 text-xs text-[var(--color-text-muted)]">
        Aegis — Claude Code Orchestration Hub
      </p>
    </div>
  );
}

export default OnboardingWizard;
