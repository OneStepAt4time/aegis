/**
 * session-detail/types.ts — Shared types for SessionDetailPage extracted modules.
 */

export type TabId = 'stream' | 'metrics' | 'audit' | 'timeline' | 'pr' | 'diff' | 'metadata';

export interface ScreenshotState {
  image: string;
  mimeType?: string;
  capturedAt: number;
}

export const COMMON_SLASH_COMMANDS = ['/clear', '/compact', '/cost', '/config'] as const;
