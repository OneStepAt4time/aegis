/**
 * stores/readingFontStore.ts — Reading font preference with localStorage persistence
 */

import { create } from 'zustand';

const STORAGE_KEY = 'aegis:reading-font';

export type ReadingFont = 'default' | 'hyperlegible' | 'dyslexia';

interface ReadingFontState {
  readingFont: ReadingFont;
  setReadingFont: (font: ReadingFont) => void;
}

function loadReadingFont(): ReadingFont {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'hyperlegible' || stored === 'dyslexia') {
      return stored;
    }
  } catch {}
  return 'default';
}

function saveReadingFont(font: ReadingFont) {
  try {
    localStorage.setItem(STORAGE_KEY, font);
  } catch {}
}

function applyReadingFontClass(font: ReadingFont) {
  document.documentElement.classList.remove('reading-font-hyperlegible', 'reading-font-dyslexia');
  if (font === 'hyperlegible') {
    document.documentElement.classList.add('reading-font-hyperlegible');
  } else if (font === 'dyslexia') {
    document.documentElement.classList.add('reading-font-dyslexia');
  }
}

export const useReadingFont = create<ReadingFontState>((set) => {
  const initialFont = loadReadingFont();
  applyReadingFontClass(initialFont);

  return {
    readingFont: initialFont,
    setReadingFont: (font) => {
      saveReadingFont(font);
      applyReadingFontClass(font);
      set({ readingFont: font });
    },
  };
});
