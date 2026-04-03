import { describe, it, expect } from 'vitest';
import { TerminalPassthrough } from '../components/session/TerminalPassthrough';

describe('TerminalPassthrough', () => {
  it('exports the component', () => {
    expect(TerminalPassthrough).toBeDefined();
    expect(typeof TerminalPassthrough).toBe('function');
  });
});
