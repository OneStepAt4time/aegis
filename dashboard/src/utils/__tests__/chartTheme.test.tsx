/**
 * chartTheme.test.ts — Tests for centralized chart theme tokens.
 *
 * @ticket #3399
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  CHART_COLORS,
  CHART_RGB,
  MODEL_COLORS,
  AGENT_COLORS,
  TOKEN_COLORS,
  TOKEN_LABELS,
  CHART_GRID,
  CHART_TICK,
  CHART_ANIMATION,
  CHART_BAR_RADIUS,
  TOOLTIP_STYLE,
  CHART_GRADIENTS,
  GradientDefs,
  ChartTooltipContent,
} from '../chartTheme';

describe('CHART_COLORS', () => {
  it('has all semantic color tokens as CSS var references', () => {
    expect(CHART_COLORS.cyan).toBe('var(--color-accent-cyan)');
    expect(CHART_COLORS.purple).toBe('var(--color-accent-purple)');
    expect(CHART_COLORS.success).toBe('var(--color-success)');
    expect(CHART_COLORS.warning).toBe('var(--color-warning)');
    expect(CHART_COLORS.danger).toBe('var(--color-danger)');
    expect(CHART_COLORS.info).toBe('var(--color-info)');
    expect(CHART_COLORS.muted).toBe('var(--color-text-muted)');
  });
});

describe('CHART_RGB', () => {
  it('has raw RGB values matching CSS vars', () => {
    expect(CHART_RGB.cyan).toBe('6, 182, 212');
    expect(CHART_RGB.purple).toBe('139, 92, 246');
    expect(CHART_RGB.success).toBe('34, 197, 94');
    expect(CHART_RGB.warning).toBe('245, 158, 11');
    expect(CHART_RGB.danger).toBe('239, 68, 68');
  });
});

describe('MODEL_COLORS', () => {
  it('maps known Claude models to correct colors', () => {
    expect(MODEL_COLORS['claude-opus-4.7']).toBe(CHART_COLORS.purple);
    expect(MODEL_COLORS['claude-sonnet-4.6']).toBe(CHART_COLORS.cyan);
    expect(MODEL_COLORS['claude-haiku-4.5']).toBe(CHART_COLORS.success);
  });

  it('has fallback for unknown models', () => {
    expect(MODEL_COLORS.other).toBe(CHART_COLORS.muted);
  });
});

describe('AGENT_COLORS', () => {
  it('maps known agents to colors', () => {
    expect(AGENT_COLORS.Daedalus).toBe(CHART_COLORS.cyan);
    expect(AGENT_COLORS.Hephaestus).toBe(CHART_COLORS.purple);
    expect(AGENT_COLORS.Themis).toBe(CHART_COLORS.danger);
  });

  it('has fallback for unknown agents', () => {
    expect(AGENT_COLORS.other).toBe(CHART_COLORS.muted);
  });
});

describe('TOKEN_COLORS', () => {
  it('maps token categories to colors', () => {
    expect(TOKEN_COLORS.inputTokens).toBe(CHART_COLORS.cyan);
    expect(TOKEN_COLORS.outputTokens).toBe(CHART_COLORS.purple);
    expect(TOKEN_COLORS.cacheReadTokens).toBe(CHART_COLORS.success);
    expect(TOKEN_COLORS.cacheWriteTokens).toBe(CHART_COLORS.warning);
  });
});

describe('TOKEN_LABELS', () => {
  it('has human-readable labels for each token category', () => {
    expect(TOKEN_LABELS.inputTokens).toBe('Input');
    expect(TOKEN_LABELS.outputTokens).toBe('Output');
    expect(TOKEN_LABELS.cacheReadTokens).toBe('Cache Read');
    expect(TOKEN_LABELS.cacheWriteTokens).toBe('Cache Write');
  });
});

describe('CHART_GRID', () => {
  it('uses CSS var for stroke', () => {
    expect(CHART_GRID.stroke).toBe('var(--color-void-lighter)');
  });

  it('has dashed pattern', () => {
    expect(CHART_GRID.strokeDasharray).toBe('3 3');
  });
});

describe('CHART_TICK', () => {
  it('uses muted text color', () => {
    expect(CHART_TICK.fill).toBe('var(--color-text-muted)');
  });

  it('has consistent font size', () => {
    expect(CHART_TICK.fontSize).toBe(11);
  });
});

describe('CHART_ANIMATION', () => {
  it('has 500ms duration', () => {
    expect(CHART_ANIMATION.duration).toBe(500);
  });
});

describe('CHART_BAR_RADIUS', () => {
  it('rounds top corners only', () => {
    expect(CHART_BAR_RADIUS).toEqual([4, 4, 0, 0]);
  });
});

describe('TOOLTIP_STYLE', () => {
  it('has container class with dark theme styling', () => {
    expect(TOOLTIP_STYLE.container).toContain('rounded-lg');
    expect(TOOLTIP_STYLE.container).toContain('border');
    expect(TOOLTIP_STYLE.container).toContain('shadow-xl');
  });

  it('has row styling classes', () => {
    expect(TOOLTIP_STYLE.row).toContain('flex');
    expect(TOOLTIP_STYLE.rowLabel).toContain('muted');
    expect(TOOLTIP_STYLE.rowValue).toContain('font-mono');
  });
});

describe('CHART_GRADIENTS', () => {
  it('has gradient definitions for all color tokens', () => {
    expect(CHART_GRADIENTS.cyan).toBeDefined();
    expect(CHART_GRADIENTS.purple).toBeDefined();
    expect(CHART_GRADIENTS.success).toBeDefined();
    expect(CHART_GRADIENTS.warning).toBeDefined();
    expect(CHART_GRADIENTS.danger).toBeDefined();
  });

  it('gradients have proper structure with stops', () => {
    const cyan = CHART_GRADIENTS.cyan;
    expect(cyan.id).toBe('gradientCyan');
    expect(cyan.stops).toHaveLength(2);
    expect(cyan.stops[0].offset).toBe('0%');
    expect(cyan.stops[1].offset).toBe('100%');
  });

  it('gradients use vertical orientation', () => {
    const purple = CHART_GRADIENTS.purple;
    expect(purple.x1).toBe('0');
    expect(purple.y1).toBe('0');
    expect(purple.x2).toBe('0');
    expect(purple.y2).toBe('1');
  });
});

describe('GradientDefs', () => {
  it('renders gradient defs for specified gradients', () => {
    const { container } = render(<GradientDefs gradients={['cyan', 'purple']} />);
    const defs = container.querySelector('defs');
    expect(defs).toBeTruthy();
    const gradients = defs!.querySelectorAll('linearGradient');
    expect(gradients).toHaveLength(2);
  });

  it('skips unknown gradient names', () => {
    const { container } = render(<GradientDefs gradients={['nonexistent']} />);
    const defs = container.querySelector('defs');
    expect(defs).toBeTruthy();
    const gradients = defs!.querySelectorAll('linearGradient');
    expect(gradients).toHaveLength(0);
  });

  it('renders empty defs for empty array', () => {
    const { container } = render(<GradientDefs gradients={[]} />);
    const defs = container.querySelector('defs');
    expect(defs).toBeTruthy();
    const gradients = defs!.querySelectorAll('linearGradient');
    expect(gradients).toHaveLength(0);
  });
});

describe('ChartTooltipContent', () => {
  it('renders with label and entries', () => {
    const { container, getByText } = render(
      <ChartTooltipContent
        label="May 15"
        entries={[
          { name: 'Cost', value: '$4.20', color: '#06b6d4' },
          { name: 'Tokens', value: '12K' },
        ]}
      />
    );
    expect(getByText('May 15')).toBeTruthy();
    expect(getByText('Cost:')).toBeTruthy();
    expect(getByText('$4.20')).toBeTruthy();
    expect(getByText('Tokens:')).toBeTruthy();
    expect(getByText('12K')).toBeTruthy();
    // Verify color dot is rendered
    const dots = container.querySelectorAll('[style*="background-color"]');
    expect(dots).toHaveLength(1);
  });

  it('renders with children', () => {
    const { getByText } = render(
      <ChartTooltipContent label="Test">
        <span>Custom child content</span>
      </ChartTooltipContent>
    );
    expect(getByText('Test')).toBeTruthy();
    expect(getByText('Custom child content')).toBeTruthy();
  });

  it('renders with minimal props', () => {
    const { container } = render(<ChartTooltipContent />);
    expect(container.firstChild).toBeTruthy();
    expect((container.firstChild as HTMLElement)?.className).toContain('rounded-lg');
  });

  it('does not render color dot when entry has no color', () => {
    const { container } = render(
      <ChartTooltipContent
        entries={[{ name: 'Value', value: '42' }]}
      />
    );
    const dots = container.querySelectorAll('[style*="background-color"]');
    expect(dots).toHaveLength(0);
  });
});
