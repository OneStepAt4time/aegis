/**
 * OnboardingWizard.test.tsx — Tests for the multi-step onboarding wizard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';

describe('OnboardingWizard', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders step 1 (Welcome) by default', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    expect(screen.getByText('Welcome to Aegis')).toBeDefined();
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('shows progress indicator with 4 steps', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuemax')).toBe('4');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('1');
  });

  it('navigates to next step on Next click', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText('Connect Your Environment')).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
  });

  it('shows copy-to-clipboard button on step 2', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByLabelText('Copy command to clipboard')).toBeDefined();
    expect(screen.getByText(/npx @anthropic-ai/)).toBeDefined();
  });

  it('navigates to previous step on Back click', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to previous step'));
    expect(screen.getByText('Welcome to Aegis')).toBeDefined();
  });

  it('disables Back button on step 1', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    expect((screen.getByLabelText('Go to previous step') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onComplete on last step', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Complete onboarding and go to dashboard'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete on Skip click', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Skip onboarding'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete on Skip tour button', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Skip tour'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('announces step changes to screen readers', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Step 1 of 4: Welcome to Aegis');
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(status.textContent).toContain('Step 2 of 4: Connect Your Environment');
  });

  it('has accessible region label', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    expect(screen.getByRole('region', { name: 'Onboarding wizard' })).toBeDefined();
  });
});
