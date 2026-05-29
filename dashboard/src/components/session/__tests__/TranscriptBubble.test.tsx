/**
 * TranscriptBubble — unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TranscriptBubble } from '../TranscriptBubble';
import type { ParsedEntry } from '../../../types';

// Mock clipboard
Object.assign(navigator, {
  clipboard: { writeText: vi.fn(() => Promise.resolve()) },
});

// Mock window.location for permalink
const originalLocation = window.location;
delete (window as unknown as Record<string, unknown>).location;
(window as unknown as Record<string, unknown>).location = { ...originalLocation, href: 'http://localhost/session/123', hash: '' } as unknown as Location;

const baseEntry: ParsedEntry = {
  role: 'assistant',
  contentType: 'text',
  text: 'Hello, world!',
  timestamp: '2026-05-27T12:00:00Z',
};

describe('TranscriptBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- System messages ---
  describe('system messages', () => {
    it('renders system message in italic muted text', () => {
      const entry: ParsedEntry = { ...baseEntry, role: 'system', text: 'Session started' };
      render(<TranscriptBubble entry={entry} index={0} />);
      expect(screen.getByText('Session started')).toBeDefined();
    });

    it('calls onFocus on click', () => {
      const onFocus = vi.fn();
      const entry: ParsedEntry = { ...baseEntry, role: 'system', text: 'init' };
      render(<TranscriptBubble entry={entry} index={5} onFocus={onFocus} />);
      fireEvent.click(screen.getByText('init'));
      expect(onFocus).toHaveBeenCalledWith(5);
    });
  });

  // --- User messages ---
  describe('user messages', () => {
    it('renders user message on the right side', () => {
      const entry: ParsedEntry = { ...baseEntry, role: 'user', text: 'My message' };
      const { container } = render(<TranscriptBubble entry={entry} index={0} />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('justify-end');
    });

    it('shows absolute timestamp for user messages', () => {
      const entry: ParsedEntry = { ...baseEntry, role: 'user', text: 'Hi', timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString() };
      render(<TranscriptBubble entry={entry} index={0} />);
      // toLocaleTimeString output varies by env, just check the time is present
      const timeEl = screen.getByTitle(/\d+m ago|\d+h ago|\d+s ago/);
      expect(timeEl).toBeDefined();
    });

    it('copies message on copy button click', () => {
      const entry: ParsedEntry = { ...baseEntry, role: 'user', text: 'copy me' };
      render(<TranscriptBubble entry={entry} index={0} />);
      const btn = screen.getByLabelText('Copy message');
      fireEvent.click(btn);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me');
    });

    it('copies permalink on permalink button click', () => {
      const entry: ParsedEntry = { ...baseEntry, role: 'user', text: 'link me' };
      render(<TranscriptBubble entry={entry} index={0} />);
      const btn = screen.getByLabelText('Copy permalink');
      fireEvent.click(btn);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it('dispatches copy-transcript-up-to event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const entry: ParsedEntry = { ...baseEntry, role: 'user', text: 'up to here' };
      render(<TranscriptBubble entry={entry} index={7} />);
      const btn = screen.getByLabelText('Copy transcript up to here');
      fireEvent.click(btn);
      expect(dispatchSpy).toHaveBeenCalled();
      const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('copy-transcript-up-to');
      expect(event.detail.index).toBe(7);
    });
  });

  // --- Assistant messages ---
  describe('assistant messages', () => {
    it('renders assistant message on the left side', () => {
      const entry: ParsedEntry = { ...baseEntry, role: 'assistant', text: 'Response' };
      const { container } = render(<TranscriptBubble entry={entry} index={0} />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('justify-start');
    });

    it('renders text content', () => {
      render(<TranscriptBubble entry={baseEntry} index={0} />);
      expect(screen.getByText('Hello, world!')).toBeDefined();
    });
  });

  // --- Thinking messages ---
  describe('thinking messages', () => {
    it('renders thinking as collapsed by default', () => {
      const entry: ParsedEntry = { ...baseEntry, contentType: 'thinking', text: 'Let me think...' };
      render(<TranscriptBubble entry={entry} index={0} />);
      expect(screen.getByText('Thinking…')).toBeDefined();
      // Content should be hidden (collapsed)
      expect(screen.queryByText('Let me think...')).toBeNull();
    });

    it('expands thinking on button click', () => {
      const entry: ParsedEntry = { ...baseEntry, contentType: 'thinking', text: 'Deep thought' };
      render(<TranscriptBubble entry={entry} index={0} />);
      fireEvent.click(screen.getByLabelText('Collapse transcript entry'));
      expect(screen.getByText('Deep thought')).toBeDefined();
    });

    it('collapses thinking again on second click', () => {
      const entry: ParsedEntry = { ...baseEntry, contentType: 'thinking', text: 'Reveal then hide' };
      render(<TranscriptBubble entry={entry} index={0} />);
      const btn = screen.getByLabelText('Collapse transcript entry');
      fireEvent.click(btn);
      expect(screen.getByText('Reveal then hide')).toBeDefined();
      fireEvent.click(btn);
      expect(screen.queryByText('Reveal then hide')).toBeNull();
    });
  });

  // --- Tool messages ---
  describe('tool_use messages', () => {
    it('renders tool_use collapsed by default with tool name', () => {
      const entry: ParsedEntry = { ...baseEntry, contentType: 'tool_use', text: 'some long tool output', toolName: 'readFile' };
      render(<TranscriptBubble entry={entry} index={0} />);
      expect(screen.getByText(/> readFile/)).toBeDefined();
    });

    it('shows truncated text when collapsed', () => {
      const longText = 'a'.repeat(100);
      const entry: ParsedEntry = { ...baseEntry, contentType: 'tool_use', text: longText, toolName: 'test' };
      render(<TranscriptBubble entry={entry} index={0} />);
      // Should show truncated (80 chars + …)
      expect(screen.getByText(`${'a'.repeat(80)}…`)).toBeDefined();
    });

    it('expands tool output on click', () => {
      const entry: ParsedEntry = { ...baseEntry, contentType: 'tool_use', text: 'full output here', toolName: 'bash' };
      render(<TranscriptBubble entry={entry} index={0} />);
      const btn = screen.getByLabelText('Collapse transcript entry');
      fireEvent.click(btn);
      expect(screen.getByText('full output here')).toBeDefined();
    });
  });

  describe('tool_result messages', () => {
    it('renders tool_result with checkmark', () => {
      const entry: ParsedEntry = { ...baseEntry, contentType: 'tool_result', text: 'ok', toolName: 'writeFile' };
      render(<TranscriptBubble entry={entry} index={0} />);
      expect(screen.getByText(/✓ writeFile/)).toBeDefined();
    });
  });

  describe('tool_error messages', () => {
    it('renders tool_error with X mark', () => {
      const entry: ParsedEntry = { ...baseEntry, contentType: 'tool_error', text: 'failed', toolName: 'exec' };
      render(<TranscriptBubble entry={entry} index={0} />);
      expect(screen.getByText(/✗ exec/)).toBeDefined();
    });

    it('applies danger border for tool_error', () => {
      const entry: ParsedEntry = { ...baseEntry, contentType: 'tool_error', text: 'err', toolName: 'test' };
      render(<TranscriptBubble entry={entry} index={0} />);
      const btn = screen.getByLabelText('Collapse transcript entry');
      expect(btn.className).toContain('border-');
    });
  });

  // --- Focus ---
  describe('focus behavior', () => {
    it('does not set tabIndex when not focused', () => {
      const { container } = render(<TranscriptBubble entry={baseEntry} index={0} focused={false} />);
      const el = container.firstChild as HTMLElement;
      expect(el.getAttribute('tabindex')).toBe('-1');
    });

    it('sets tabIndex=0 when focused', () => {
      const { container } = render(<TranscriptBubble entry={baseEntry} index={0} focused={true} />);
      const el = container.firstChild as HTMLElement;
      expect(el.getAttribute('tabindex')).toBe('0');
    });
  });

  // --- Keyboard shortcut ---
  describe('keyboard shortcut', () => {
    it('copies text on "c" key press without modifier', () => {
      const { container } = render(<TranscriptBubble entry={baseEntry} index={0} />);
      fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'c', ctrlKey: false, metaKey: false });
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Hello, world!');
    });

    it('does not copy on Ctrl+C', () => {
      const { container } = render(<TranscriptBubble entry={baseEntry} index={0} />);
      fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'c', ctrlKey: true });
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    });
  });

  // --- Timestamps ---
  describe('timestamps', () => {
    it('hides time column when no timestamp', () => {
      const entry: ParsedEntry = { ...baseEntry, timestamp: undefined };
      render(<TranscriptBubble entry={entry} index={0} />);
      // No time element should be present
      const timeEl = screen.queryByText(/\d{1,2}:\d{2}/);
      // In assistant mode, time is shown next to bubble; without timestamp, it's not
      expect(timeEl).toBeNull();
    });

    it('shows relative time on hover', () => {
      const entry: ParsedEntry = { ...baseEntry, role: 'assistant', text: 'msg', timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString() };
      render(<TranscriptBubble entry={entry} index={0} />);
      const timeEl = screen.getByTitle(/\d+[mhs] ago/);
      // Hover to show relative time
      fireEvent.mouseEnter(timeEl);
      expect(timeEl.textContent).toMatch(/\d+[mhs] ago/);
    });
  });

  // --- ID generation ---
  describe('element ID', () => {
    it('generates ID from toolUseId when present', () => {
      const entry: ParsedEntry = { ...baseEntry, toolUseId: 'tool-123' };
      const { container } = render(<TranscriptBubble entry={entry} index={0} />);
      expect((container.firstChild as HTMLElement).id).toBe('msg-tool-123');
    });

    it('generates ID from role-timestamp-index when no toolUseId', () => {
      const entry: ParsedEntry = { ...baseEntry, timestamp: '2026-05-27T12:00:00Z' };
      const { container } = render(<TranscriptBubble entry={entry} index={3} />);
      expect((container.firstChild as HTMLElement).id).toMatch(/^msg-assistant-/);
    });
  });
});
