/**
 * hooks/useTheme.ts — Dark/light theme toggle with system preference detection.
 * Supports dark, light, light-paper, light-aaa, and auto (system preference).
 */

import { useEffect, useState } from 'react';

/** Full set of supported themes. 'auto' tracks system prefers-color-scheme. */
export type Theme = 'dark' | 'light' | 'light-paper' | 'light-aaa' | 'auto';

/** The resolved (applied) theme — never 'auto'. */
export type ResolvedTheme = Exclude<Theme, 'auto'>;

const STORAGE_KEY = 'aegis-dashboard-theme';

function getSystemPreference(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (
      stored === 'dark' ||
      stored === 'light' ||
      stored === 'light-paper' ||
      stored === 'light-aaa' ||
      stored === 'auto'
    )
      return stored;
  } catch {}
  return null;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return getStoredTheme() ?? getSystemPreference();
  });

  // Tracks current system preference to resolve 'auto' dynamically.
  const [systemPref, setSystemPref] = useState<'dark' | 'light'>(getSystemPreference);

  const resolvedTheme: ResolvedTheme = theme === 'auto' ? systemPref : theme;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    // Keep Tailwind dark: variants in sync with the active theme
    if (resolvedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {}
  }, [theme, resolvedTheme]);

  // Listen for system preference changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      const newPref = e.matches ? 'light' : 'dark';
      setSystemPref(newPref);
      // Legacy: if no explicit preference stored, follow system changes
      if (!getStoredTheme()) {
        setThemeState(newPref);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  /** Toggle between dark and light (collapses sub-themes to 'light'). */
  const toggleTheme = () => {
    setThemeState((prev) => {
      const effective =
        prev === 'auto'
          ? systemPref
          : prev === 'light-paper' || prev === 'light-aaa'
            ? 'light'
            : prev;
      return effective === 'dark' ? 'light' : 'dark';
    });
  };

  /** Explicitly set any theme including sub-themes and 'auto'. */
  const setTheme = (t: Theme) => setThemeState(t);

  return { theme, resolvedTheme, toggleTheme, setTheme };
}
