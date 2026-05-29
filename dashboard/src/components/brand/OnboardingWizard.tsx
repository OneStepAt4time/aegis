/**
 * pages/OnboardingWizard.tsx — Multi-step first-run onboarding wizard.
 * Shows on first authenticated visit. Stores completion in localStorage.
 *
 * Steps:
 *  1. Welcome — Aegis branding + intro
 *  2. Connect — guide user to run `ag init` or show connected status
 *  3. First Session — walk through creating a session or show active sessions
 *  4. Explore — highlight key dashboard pages with real session count
 */

import { useState, useCallback, useEffect, useRef } from 'react';
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
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Plus,
} from 'lucide-react';
import { getHealth } from '../../api/health';
import { useDrawerStore } from '../../store/useDrawerStore';
import { useT } from '../../i18n/context';

const TOTAL_STEPS = 4;

const CONNECT_SNIPPET = 'npx @anthropic-ai/claude-code@latest && ag init';

interface HealthState {
  claudeAvailable: boolean;
  claudeVersion: string | null;
  claudeHealthy: boolean;
  activeSessions: number;
  totalSessions: number;
}

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

/** Step 1 — Welcome */
function WelcomeStep() {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent-cyan)]/10 ring-1 ring-[var(--color-accent-cyan)]/20"
        aria-hidden="true"
      >
        <Rocket className="h-8 w-8 text-[var(--color-accent-cyan)]" />
      </div>
      <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
        Welcome to Aegis
      </h2>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--color-text-muted)] whitespace-pre-line">
        Your Claude Code orchestration hub. Monitor sessions, manage permissions, and track costs — all from one dashboard.
      </p>
    </div>
  );
}

/** Step 2 — Connect (health-aware) */
function ConnectStep({ health, loading }: { health: HealthState | null; loading: boolean }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent-cyan)]/10 ring-1 ring-[var(--color-accent-cyan)]/20"
        aria-hidden="true"
      >
        <Terminal className="h-8 w-8 text-[var(--color-accent-cyan)]" />
      </div>

      {loading ? (
        <>
          <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
            Checking connection…
          </h2>
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Detecting Claude Code status
          </div>
        </>
      ) : health?.claudeAvailable && health.claudeHealthy ? (
        <>
          <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
            Claude Code Connected ✅
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              Claude Code v{health.claudeVersion} detected and healthy.
            </span>
          </p>
        </>
      ) : health?.claudeAvailable && !health.claudeHealthy ? (
        <>
          <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
            Claude Code Detected
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              Claude Code was found but may have issues. You can still proceed.
            </span>
          </p>
        </>
      ) : (
        <>
          <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
            Connect Your Environment
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--color-text-muted)]">
            Run the CLI init command to connect your Claude Code sessions to Aegis. Copy the snippet below and paste it into your terminal.
          </p>
          <div className="mt-6 w-full max-w-md">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-void-dark)] p-3">
              <code className="flex-1 overflow-x-auto text-left text-xs font-mono text-[var(--color-accent-cyan)]">
                {CONNECT_SNIPPET}
              </code>
              <CopyButton text={CONNECT_SNIPPET} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Step 3 — First Session (health-aware) */
function FirstSessionStep({ health, onCreateSession }: { health: HealthState | null; onCreateSession: () => void }) {
  const hasActive = (health?.activeSessions ?? 0) > 0;
  const t = useT();

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent-cyan)]/10 ring-1 ring-[var(--color-accent-cyan)]/20"
        aria-hidden="true"
      >
        <Play className="h-8 w-8 text-[var(--color-accent-cyan)]" />
      </div>

      {hasActive ? (
        <>
          <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
            Sessions Running!
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--color-text-muted)]">
            You have {health!.activeSessions} active {health!.activeSessions === 1 ? 'session' : 'sessions'}.
            Head to the Sessions page to monitor them in real-time.
          </p>
        </>
      ) : (
        <>
          <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
            Create Your First Session
          </h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--color-text-muted)]">
            Once connected, create a new Claude Code session from the dashboard. Aegis will handle permissions, audit logging, and real-time monitoring automatically.
          </p>
          <button
            type="button"
            onClick={onCreateSession}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent-cyan)] px-4 py-2.5 text-sm font-bold text-[var(--color-void-dark)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
            aria-label={t('aria.createFirstSession')}
          >
            <Plus className="h-4 w-4" />
            Create Your First Session
          </button>
        </>
      )}
    </div>
  );
}

/** Step 4 — Explore (health-aware) */
function ExploreStep({ health }: { health: HealthState | null }) {
  const total = health?.totalSessions ?? 0;

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-accent-cyan)]/10 ring-1 ring-[var(--color-accent-cyan)]/20"
        aria-hidden="true"
      >
        <Compass className="h-8 w-8 text-[var(--color-accent-cyan)]" />
      </div>
      <h2 className="mb-3 text-2xl font-bold text-[var(--color-text-primary)]">
        Explore the Dashboard
      </h2>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--color-text-muted)]">
        {total > 0
          ? `${total} session${total === 1 ? '' : 's'} monitored so far. Here are the key pages to explore:`
          : "You're all set! Key pages to check out:"}
      </p>
      <ul className="mt-4 space-y-1 text-left text-sm text-[var(--color-text-muted)]">
        <li>• <strong className="text-[var(--color-text-primary)]">Sessions</strong> — live session monitoring and history</li>
        <li>• <strong className="text-[var(--color-text-primary)]">Analytics</strong> — usage metrics and agent contributions</li>
        <li>• <strong className="text-[var(--color-text-primary)]">Cost</strong> — token tracking and budget alerts</li>
        <li>• <strong className="text-[var(--color-text-primary)]">Settings</strong> — configure preferences and API keys</li>
      </ul>
    </div>
  );
}

function ProgressIndicator({ current, completedSteps }: { current: number; completedSteps: Set<number> }) {
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-label={`Step ${current} of ${TOTAL_STEPS}`}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === current;
        const isComplete = completedSteps.has(stepNum);

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
              {isComplete && !isActive ? <Check className="h-4 w-4" /> : stepNum}
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
  const t = useT();
  const [currentStep, setCurrentStep] = useState(1);
  const [health, setHealth] = useState<HealthState | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const healthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openNewSession = useDrawerStore((s) => s.openNewSession);

  // Fetch health on mount
  useEffect(() => {
    let cancelled = false;

    // 3-second timeout fallback
    healthTimeoutRef.current = setTimeout(() => {
      if (!cancelled) {
        setHealthLoading(false);
      }
    }, 3000);

    getHealth()
      .then((h) => {
        if (cancelled) return;
        if (healthTimeoutRef.current) clearTimeout(healthTimeoutRef.current);
        setHealth({
          claudeAvailable: h.claude?.available ?? false,
          claudeVersion: h.claude?.version ?? null,
          claudeHealthy: h.claude?.healthy ?? false,
          activeSessions: h.sessions.active,
          totalSessions: h.sessions.total,
        });
        setHealthLoading(false);

        // Auto-mark step 2 as completed when Claude is connected
        if (h.claude?.available && h.claude.healthy) {
          setCompletedSteps((prev) => new Set([...prev, 2]));
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (healthTimeoutRef.current) clearTimeout(healthTimeoutRef.current);
        // Health check failed — show default (disconnected) state
        setHealthLoading(false);
      });

    return () => {
      cancelled = true;
      if (healthTimeoutRef.current) clearTimeout(healthTimeoutRef.current);
    };
  }, []);

  const isLastStep = currentStep === TOTAL_STEPS;

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onComplete();
      // If no active sessions, open the new session drawer after completing
      if ((health?.activeSessions ?? 0) === 0) {
        openNewSession();
      }
    } else {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
    }
  }, [isLastStep, onComplete, health, openNewSession, currentStep]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 1));
  }, []);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleCreateSession = useCallback(() => {
    onComplete();
    openNewSession();
  }, [onComplete, openNewSession]);

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
    const titles = ['Welcome to Aegis', 'Connect Your Environment', 'Create Your First Session', 'Explore the Dashboard'];
    setAnnouncement(`Step ${currentStep} of ${TOTAL_STEPS}: ${titles[currentStep - 1]}`);
  }, [currentStep]);

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <WelcomeStep />;
      case 2:
        return <ConnectStep health={health} loading={healthLoading} />;
      case 3:
        return <FirstSessionStep health={health} onCreateSession={handleCreateSession} />;
      case 4:
        return <ExploreStep health={health} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-void-dark)] p-6"
      role="region"
      aria-label={t('aria.onboardingWizard')}
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
        aria-label={t('aria.skipOnboarding')}
      >
        <X className="h-5 w-5" />
      </button>

      {/* Wizard card */}
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-8 shadow-2xl">
        {/* Progress */}
        <div className="mb-8 flex justify-center">
          <ProgressIndicator current={currentStep} completedSteps={completedSteps} />
        </div>

        {/* Step content */}
        <div className="mb-8 min-h-[240px] flex items-center">
          {renderStep()}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 1}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)]"
            aria-label={t('aria.goToPreviousStep')}
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
