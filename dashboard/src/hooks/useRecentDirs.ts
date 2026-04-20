import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'aegis:recent-dirs:v1';
const MAX_DIRS = 10;

export interface RecentDir {
  path: string;
  label?: string;
  starred: boolean;
  lastUsed: number;
}

function loadFromStorage(): RecentDir[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentDir =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RecentDir).path === 'string' &&
        typeof (item as RecentDir).starred === 'boolean' &&
        typeof (item as RecentDir).lastUsed === 'number',
    );
  } catch {
    return [];
  }
}

function saveToStorage(dirs: RecentDir[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dirs));
  } catch {
    // ignore storage errors
  }
}

export function useRecentDirs(): {
  recent: RecentDir[];
  starred: RecentDir[];
  add: (path: string) => void;
  toggleStar: (path: string) => void;
  remove: (path: string) => void;
} {
  const [dirs, setDirs] = useState<RecentDir[]>(() => loadFromStorage());

  useEffect(() => {
    saveToStorage(dirs);
  }, [dirs]);

  const add = useCallback((path: string) => {
    if (!path.trim()) return;
    setDirs((prev) => {
      const existing = prev.find((d) => d.path === path);
      const updated: RecentDir = existing
        ? { ...existing, lastUsed: Date.now() }
        : { path, starred: false, lastUsed: Date.now() };
      const filtered = prev.filter((d) => d.path !== path);
      const next = [updated, ...filtered].slice(0, MAX_DIRS);
      return next;
    });
  }, []);

  const toggleStar = useCallback((path: string) => {
    setDirs((prev) =>
      prev.map((d) => (d.path === path ? { ...d, starred: !d.starred } : d)),
    );
  }, []);

  const remove = useCallback((path: string) => {
    setDirs((prev) => prev.filter((d) => d.path !== path));
  }, []);

  const sorted = [...dirs].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    return b.lastUsed - a.lastUsed;
  });

  return {
    recent: sorted,
    starred: sorted.filter((d) => d.starred),
    add,
    toggleStar,
    remove,
  };
}
