/**
 * components/brand/OnboardingScreen.tsx
 *
 * Full-screen welcome animation shown on first visit.
 * Four-step sequence:
 * 1. Shield logo scales in (0 → 1, spring ease)
 * 2. "Aegis" wordmark fades in
 * 3. Tagline types in character-by-character
 * 4. CTA button appears
 *
 * Sets localStorage `aegis:onboarded: true` on completion or skip.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldLogoMark } from './ShieldLogo';
import { Typewriter } from './Typewriter';

interface OnboardingScreenProps {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState<number>(0);

  useEffect(() => {
    if (step === 0) {
      const timer = setTimeout(() => setStep(1), 800);
      return () => clearTimeout(timer);
    }
    if (step === 1) {
      const timer = setTimeout(() => setStep(2), 600);
      return () => clearTimeout(timer);
    }
  }, [step]);

  function handleTypewriterDone() {
    setStep(3);
  }

  function handleContinue() {
    try {
      localStorage.setItem('aegis:onboarded', 'true');
      sessionStorage.setItem('aegis:onboarded', 'true');
    } catch {
      // Ignore storage errors
    }
    onComplete();
  }

  function handleSkip() {
    try {
      localStorage.setItem('aegis:onboarded', 'true');
      sessionStorage.setItem('aegis:onboarded', 'true');
    } catch {
      // Ignore storage errors
    }
    onComplete();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ backgroundColor: 'var(--color-void)' }}
    >
      <button
        onClick={handleSkip}
        className="absolute top-6 right-6 px-4 py-2 text-sm font-medium rounded-md transition-colors"
        style={{
          color: 'var(--color-text-muted)',
          backgroundColor: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--color-surface-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        Skip
      </button>

      <div className="flex flex-col items-center gap-8 max-w-2xl px-6">
        <AnimatePresence mode="wait">
          {step >= 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 260,
                damping: 20,
              }}
            >
              <ShieldLogoMark size="xl" className="drop-shadow-[0_0_24px_rgba(34,197,94,0.8)]" />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {step >= 1 && (
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="text-4xl md:text-5xl font-bold tracking-tight"
              style={{ color: 'var(--color-brand)' }}
            >
              Aegis
            </motion.h1>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {step >= 2 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="text-lg md:text-xl text-center"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <Typewriter
                text="Your Claude Code Control Plane"
                speed={30}
                onDone={handleTypewriterDone}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {step >= 3 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              onClick={handleContinue}
              className="px-8 py-3 font-semibold rounded-lg transition-all shadow-lg"
              style={{
                backgroundColor: 'var(--color-cta-bg)',
                color: 'var(--color-cta-text)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-cta-bg-hover)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-cta-bg)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              Open Dashboard →
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default OnboardingScreen;
