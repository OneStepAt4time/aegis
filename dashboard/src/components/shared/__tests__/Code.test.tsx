import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Code } from '../Code';

describe('Code', () => {
  it('renders inline code with <code> tag', () => {
    const { container } = render(<Code inline>hello</Code>);
    const code = container.querySelector('code');
    expect(code).toBeTruthy();
    expect(code?.textContent).toBe('hello');
  });

  it('renders inline code with data-numeric attribute', () => {
    const { container } = render(<Code inline>42</Code>);
    const code = container.querySelector('code');
    expect(code?.getAttribute('data-numeric')).toBe('true');
  });

  it('applies inline classes', () => {
    const { container } = render(<Code inline>inline content</Code>);
    const code = container.querySelector('code');
    expect(code?.className).toContain('font-mono');
    expect(code?.className).toContain('px-1.5');
  });

  it('applies custom className', () => {
    const { container } = render(<Code inline className="my-custom">x</Code>);
    const code = container.querySelector('code');
    expect(code?.className).toContain('my-custom');
  });

  it('renders block code with <pre> wrapper when inline is false', () => {
    const { container } = render(<Code>block content</Code>);
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe('block content');
  });

  it('sets data-lang on block code', () => {
    const { container } = render(<Code lang="typescript">const x = 1;</Code>);
    const pre = container.querySelector('pre');
    expect(pre?.getAttribute('data-lang')).toBe('typescript');
  });

  it('sets data-lang to undefined when lang is not provided', () => {
    const { container } = render(<Code>no lang</Code>);
    const pre = container.querySelector('pre');
    expect(pre?.getAttribute('data-lang')).toBeNull();
  });

  it('block code has nested <code> element with data-numeric', () => {
    const { container } = render(<Code>some code</Code>);
    const code = container.querySelector('pre code');
    expect(code).toBeTruthy();
    expect(code?.getAttribute('data-numeric')).toBe('true');
  });

  it('block code applies custom className to pre', () => {
    const { container } = render(<Code className="extra">code</Code>);
    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('extra');
  });

  it('defaults inline to false', () => {
    const { container } = render(<Code>default block</Code>);
    expect(container.querySelector('pre')).toBeTruthy();
    expect(container.querySelector('code[data-numeric]')?.parentElement?.tagName).toBe('PRE');
  });
});
