import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClaudeStatusStrip, parseStatusFooter } from '../components/session/ClaudeStatusStrip';

describe('ClaudeStatusStrip — renders props', () => {
  it('renders version', () => {
    render(<ClaudeStatusStrip version="2.5.0" thinking={false} />);
    expect(screen.getByText(/claude v2\.5\.0/i)).toBeDefined();
  });

  it('renders model', () => {
    render(<ClaudeStatusStrip model="claude-3-5-sonnet-20241022" thinking={false} />);
    expect(screen.getByText(/claude-3-5-sonnet/)).toBeDefined();
  });

  it('renders effort', () => {
    render(<ClaudeStatusStrip effort="high" thinking={false} />);
    expect(screen.getByText(/high effort/)).toBeDefined();
  });

  it('renders low effort', () => {
    render(<ClaudeStatusStrip effort="low" thinking={false} />);
    expect(screen.getByText(/low effort/)).toBeDefined();
  });

  it('renders medium effort', () => {
    render(<ClaudeStatusStrip effort="medium" thinking={false} />);
    expect(screen.getByText(/medium effort/)).toBeDefined();
  });

  it('renders Thinking indicator when thinking=true', () => {
    render(<ClaudeStatusStrip thinking={true} />);
    expect(screen.getByLabelText('Claude is thinking')).toBeDefined();
    expect(screen.getByText('Thinking')).toBeDefined();
  });

  it('does NOT render Thinking indicator when thinking=false', () => {
    render(<ClaudeStatusStrip thinking={false} />);
    expect(screen.queryByLabelText('Claude is thinking')).toBeNull();
  });

  it('renders all parts together', () => {
    render(
      <ClaudeStatusStrip
        version="2.5.0"
        model="claude-opus-4"
        effort="medium"
        thinking={false}
      />,
    );
    const strip = screen.getByLabelText('Claude runtime status');
    expect(strip.textContent).toContain('claude v2.5.0');
    expect(strip.textContent).toContain('claude-opus-4');
    expect(strip.textContent).toContain('medium effort');
  });

  it('renders nothing but container when no props provided', () => {
    const { container } = render(<ClaudeStatusStrip thinking={false} />);
    expect(container.firstChild).toBeTruthy();
  });
});

describe('parseStatusFooter', () => {
  it('detects thinking from "· Thinking…"', () => {
    const result = parseStatusFooter('· Thinking…');
    expect(result.thinking).toBe(true);
  });

  it('does not flag non-Thinking gerunds as thinking', () => {
    const result = parseStatusFooter('· Frolicking…');
    expect(result.thinking).toBe(false);
  });

  it('parses effort level from footer', () => {
    expect(parseStatusFooter('esc to interrupt · high · /effort').effort).toBe('high');
    expect(parseStatusFooter('esc to interrupt · low · /effort').effort).toBe('low');
    expect(parseStatusFooter('esc to interrupt · medium · /effort').effort).toBe('medium');
  });

  it('parses version from "claude 2.5.0"', () => {
    expect(parseStatusFooter('claude 2.5.0 · claude-3-5-sonnet').version).toBe('2.5.0');
  });

  it('parses model from footer', () => {
    expect(parseStatusFooter('claude 2.5.0 · claude-3-5-sonnet-20241022').model).toBe('claude-3-5-sonnet-20241022');
  });
});
