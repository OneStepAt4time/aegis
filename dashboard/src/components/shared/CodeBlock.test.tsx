/**
 * CodeBlock tests — safe, component-based syntax highlighting.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeBlock, RenderWithCodeBlocks } from './CodeBlock';

vi.mock('../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe('CodeBlock', () => {
  it('renders code content', () => {
    render(<CodeBlock code="console.log('hello')" language="typescript" />);
    const pre = screen.getByText(/console\.log/, { selector: 'pre code' });
    expect(pre).not.toBeNull();
  });

  it('shows language label', () => {
    render(<CodeBlock code="x = 1" language="python" />);
    expect(screen.getByText('python')).not.toBeNull();
  });

  it('shows "code" when no language provided', () => {
    render(<CodeBlock code="hello" language="" />);
    expect(screen.getByText('code')).not.toBeNull();
  });

  it('copy button has aria-label', () => {
    render(<CodeBlock code="test" language="bash" />);
    expect(screen.getByLabelText('aria.copyCode')).not.toBeNull();
  });

  it('highlights keywords using CSS class', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="typescript" />);
    const kwSpan = container.querySelector('.syn-keyword');
    expect(kwSpan).not.toBeNull();
    expect(kwSpan?.textContent).toBe('const');
  });

  it('highlights strings using CSS class', () => {
    const { container } = render(<CodeBlock code="'hello world'" language="typescript" />);
    const strSpan = container.querySelector('.syn-string');
    expect(strSpan).not.toBeNull();
    expect(strSpan?.textContent).toBe("'hello world'");
  });

  it('renders inside a pre element', () => {
    const { container } = render(<CodeBlock code="hello" language="text" />);
    expect(container.querySelector('pre')).not.toBeNull();
  });

  it('does NOT use dangerouslySetInnerHTML', () => {
    const { container } = render(<CodeBlock code="<script>alert(1)</script>" language="html" />);
    const codeEl = container.querySelector('code');
    expect(codeEl).not.toBeNull();
    // React renders text nodes, not raw HTML — no dangerouslySetInnerHTML
    expect(codeEl?.innerHTML).not.toContain('dangerouslySetInnerHTML');
    // XSS payload should appear as escaped text, not a real script tag
    expect(codeEl?.querySelector('script')).toBeNull();
  });

  it('highlights Python comments with syn-comment class', () => {
    const { container } = render(<CodeBlock code="# this is a comment" language="python" />);
    const commentSpan = container.querySelector('.syn-comment');
    expect(commentSpan).not.toBeNull();
    expect(commentSpan?.textContent).toBe('# this is a comment');
  });

  it('highlights numbers with syn-number class', () => {
    const { container } = render(<CodeBlock code="const x = 42;" language="typescript" />);
    const numSpan = container.querySelector('.syn-number');
    expect(numSpan).not.toBeNull();
    expect(numSpan?.textContent).toBe('42');
  });

  it('handles shell keywords', () => {
    const { container } = render(<CodeBlock code="sudo npm install" language="bash" />);
    const kwSpans = container.querySelectorAll('.syn-keyword');
    expect(kwSpans.length).toBeGreaterThanOrEqual(2);
  });

  it('handles multi-line comment blocks', () => {
    const { container } = render(<CodeBlock code="/* comment\n   block */" language="javascript" />);
    const commentSpan = container.querySelector('.syn-comment');
    expect(commentSpan).not.toBeNull();
    expect(commentSpan?.textContent).toContain('/* comment');
  });
});

describe('RenderWithCodeBlocks', () => {
  it('renders plain text without code blocks', () => {
    render(<RenderWithCodeBlocks text="Hello world" />);
    expect(screen.getByText('Hello world')).not.toBeNull();
  });

  it('parses and renders fenced code blocks', () => {
    const text = 'Before\n```js\nconsole.log("hi")\n```\nAfter';
    render(<RenderWithCodeBlocks text={text} />);
    expect(screen.getByText('js')).not.toBeNull();
  });

  it('handles text with no code blocks', () => {
    render(<RenderWithCodeBlocks text="Just text, no code." />);
    expect(screen.getByText('Just text, no code.')).not.toBeNull();
  });
});
