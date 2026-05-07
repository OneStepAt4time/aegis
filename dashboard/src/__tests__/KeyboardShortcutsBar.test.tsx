/**
 * __tests__/KeyboardShortcutsBar.test.tsx — Tests for CCMeter keyboard shortcuts bar.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyboardShortcutsBar } from '../components/shared/KeyboardShortcutsBar';

describe('KeyboardShortcutsBar', () => {
  it('renders default shortcuts', () => {
    render(<KeyboardShortcutsBar />);
    expect(screen.getByText('New session')).not.toBeNull();
    expect(screen.getByText('Command palette')).not.toBeNull();
    expect(screen.getByText('Toggle theme')).not.toBeNull();
    expect(screen.getByText('Show shortcuts')).not.toBeNull();
  });

  it('renders custom shortcuts', () => {
    render(
      <KeyboardShortcutsBar
        shortcuts={[
          { keys: ['Ctrl', 'S'], label: 'Save' },
          { keys: ['Esc'], label: 'Close' },
        ]}
      />
    );
    expect(screen.getByText('Save')).not.toBeNull();
    expect(screen.getByText('Close')).not.toBeNull();
  });

  it('has contentinfo role', () => {
    render(<KeyboardShortcutsBar />);
    expect(screen.getByRole('contentinfo', { name: 'Keyboard shortcuts' })).not.toBeNull();
  });

  it('renders kbd elements for keys', () => {
    const { container } = render(<KeyboardShortcutsBar />);
    const kbds = container.querySelectorAll('kbd');
    expect(kbds.length).toBeGreaterThan(0);
  });
});
