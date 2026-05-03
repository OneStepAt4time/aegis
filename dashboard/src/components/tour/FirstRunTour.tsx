/**
 * components/tour/FirstRunTour.tsx — Interactive first-run onboarding tour.
 * Creates a real session in a sandbox dir, walks through permission prompt, approval, kill.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, PlayCircle, CheckCircle2, Shield, Trash2, Lightbulb } from 'lucide-react';
import { createSession, approve, killSession, getSessions } from '../../api/client';
import { useToastStore } from '../../store/useToastStore';
import type { SessionInfo } from '../../types';

const TOUR_COMPLETED_KEY = 'aegis:tour:completed';
const SANDBOX_DIR = '/tmp/aegis-tour';

type TourStep = 'welcome' | 'creating' | 'waiting-permission' | 'approved' | 'killing' | 'complete';

interface FirstRunTourProps {
  onComplete: () => void;
}

export function FirstRunTour({ onComplete }: FirstRunTourProps) {
  const [step, setStep] = useState<TourStep>('welcome');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  // Listen for Esc key to skip tour
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleSkip();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  async function handleStart() {
    setStep('creating');
    setError(null);
    
    try {
      const result = await createSession({
        workDir: SANDBOX_DIR,
        name: 'aegis-tour',
        prompt: 'This is a tutorial session. Say "Hello from the tour!"',
      });
      setSessionId(result.id);
      setStep('waiting-permission');
      
      // Poll for permission prompt
      pollForPermission(result.id);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      addToast('error', 'Tour failed', 'Could not create tutorial session');
      setStep('welcome');
    }
  }

  async function pollForPermission(id: string) {
    // Poll every 2s for up to 30s to detect permission prompt
    let attempts = 0;
    const maxAttempts = 15;
    
    const interval = setInterval(async () => {
      attempts++;
      
      try {
        const response = await getSessions();
        const session = response.sessions.find((s: SessionInfo) => s.id === id);
        
        if (session?.status === 'permission_prompt') {
          clearInterval(interval);
          // Small delay for dramatic effect
          setTimeout(() => {
            setStep('approved');
          }, 1000);
        }
        
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setStep('approved'); // Continue anyway
        }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err: unknown) {
        // Ignore polling errors
      }
    }, 2000);
  }

  async function handleApprove() {
    if (!sessionId) return;
    
    try {
      await approve(sessionId);
      addToast('success', 'Permission approved', 'The session can now execute commands');
      
      // Wait a bit then move to kill step
      setTimeout(() => {
        setStep('killing');
      }, 2000);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve permission');
      addToast('error', 'Approval failed', 'Could not approve session');
    }
  }

  async function handleKill() {
    if (!sessionId) return;
    setStep('complete');
    
    try {
      await killSession(sessionId);
      addToast('success', 'Session killed', 'Tutorial session cleaned up');
      
      // Mark tour as completed
      try {
        localStorage.setItem(TOUR_COMPLETED_KEY, '1');
        sessionStorage.setItem(TOUR_COMPLETED_KEY, '1');
      } catch {
        // Ignore storage errors
      }
      
      // Wait a bit then close
      setTimeout(() => {
        onComplete();
      }, 2000);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err: unknown) {
      // Still mark as complete even if kill fails
      addToast('warning', 'Cleanup note', 'You may need to manually kill the tour session');
      setTimeout(() => {
        onComplete();
      }, 2000);
    }
  }

  function handleSkip() {
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, '1');
      sessionStorage.setItem(TOUR_COMPLETED_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    onComplete();
  }

  const stepContent: Record<TourStep, { title: string; description: string; icon: React.ReactNode; action?: React.ReactNode }> = {
    welcome: {
      title: 'Welcome to Aegis',
      description: 'Let\'s take a quick tour to see how session management works. We\'ll create a real session, handle permissions, and clean up.',
      icon: <Lightbulb className="h-12 w-12 text-[var(--color-accent-cyan)]" />,
      action: (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleStart}
            className="px-6 py-2.5 rounded-lg bg-[var(--color-accent-cyan)] text-[var(--color-void-dark)] font-medium transition-opacity hover:opacity-90"
          >
            Start Tour
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className="px-6 py-2.5 rounded-lg border border-[var(--color-void-lighter)] text-[var(--color-text-muted)] font-medium transition-colors hover:border-[var(--color-text-muted)]"
          >
            Skip
          </button>
        </div>
      ),
    },
    creating: {
      title: 'Creating session...',
      description: `We're creating a tutorial session in ${SANDBOX_DIR}. This only takes a moment.`,
      icon: <PlayCircle className="h-12 w-12 text-[var(--color-accent-cyan)] animate-pulse" />,
    },
    'waiting-permission': {
      title: 'Waiting for permission prompt',
      description: 'Claude Code will ask for permission before running commands. Watch for the permission prompt status.',
      icon: <Shield className="h-12 w-12 text-amber-400 animate-pulse" />,
    },
    approved: {
      title: 'Approve the permission',
      description: 'Click below to approve the session\'s permission request. This allows Claude Code to execute commands in the working directory.',
      icon: <Shield className="h-12 w-12 text-[var(--color-accent-cyan)]" />,
      action: (
        <button
          type="button"
          onClick={handleApprove}
          className="px-6 py-2.5 rounded-lg bg-[var(--color-accent-cyan)] text-[var(--color-void-dark)] font-medium transition-opacity hover:opacity-90"
        >
          Approve Permission
        </button>
      ),
    },
    killing: {
      title: 'Clean up the session',
      description: 'Now let\'s clean up by killing the tutorial session. This stops the tmux session and removes it from the active list.',
      icon: <Trash2 className="h-12 w-12 text-red-400" />,
      action: (
        <button
          type="button"
          onClick={handleKill}
          className="px-6 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 font-medium transition-colors hover:bg-red-500/20"
        >
          Kill Session
        </button>
      ),
    },
    complete: {
      title: 'Tour complete!',
      description: 'You now know the basics: create sessions, handle permissions, and manage cleanup. Happy orchestrating!',
      icon: <CheckCircle2 className="h-12 w-12 text-emerald-400" />,
    },
  };

  const currentStep = stepContent[step];
  const stepIndex = ['welcome', 'creating', 'waiting-permission', 'approved', 'killing', 'complete'].indexOf(step);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative max-w-md w-full mx-4 rounded-xl border border-[var(--color-void-lighter)] bg-[var(--color-surface)] shadow-2xl p-8"
        >
          {/* Close/Skip button */}
          {step !== 'complete' && (
            <button
              type="button"
              onClick={handleSkip}
              className="absolute top-4 right-4 p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-dark)] transition-colors"
              aria-label="Skip tour"
              title="Press Esc to skip"
            >
              <X className="h-5 w-5" />
            </button>
          )}

          {/* Step indicator */}
          <div className="flex gap-1.5 mb-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= stepIndex ? 'bg-[var(--color-accent-cyan)]' : 'bg-[var(--color-void-lighter)]'
                }`}
              />
            ))}
          </div>

          {/* Content */}
          <div className="flex flex-col items-center text-center">
            <div className="mb-4">{currentStep.icon}</div>
            <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
              {currentStep.title}
            </h2>
            <p className="text-sm text-[var(--color-text-muted)] mb-6">
              {currentStep.description}
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                {error}
              </div>
            )}

            {currentStep.action && (
              <div className="w-full flex justify-center">
                {currentStep.action}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Check if the tour has been completed
 */
export function isTourCompleted(): boolean {
  try {
    return localStorage.getItem(TOUR_COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}
