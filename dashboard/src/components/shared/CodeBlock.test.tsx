/**
 * CodeBlock tests — syntax-highlighted code renderer.
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

  it('highlights keywords in code', () => {
    const { container } = render(<CodeBlock code="const x = 1;" language="typescript" />);
    const highlighted = container.querySelector('span[style]');
    expect(highlighted).not.toBeNull();
  });

  it('renders inside a pre element', () => {
    const { container } = render(<CodeBlock code="hello" language="text" />);
    expect(container.querySelector('pre')).not.toBeNull();
  });

  it('handles python comments correctly', () => {
    const { container } = render(<CodeBlock code="# this is a comment" language="python" />);
    const html = container.querySelector('pre code')?.innerHTML;
    expect(html).toContain('#8b949e'); // comment color
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
