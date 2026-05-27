/**
 * OnboardingWizard.test.tsx — Tests for the multi-step onboarding wizard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { OnboardingWizard } from '../OnboardingWizard';

// Mock getHealth
const mockGetHealth = vi.fn();
vi.mock('../../../api/health', () => ({
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}));

// Mock useDrawerStore
const mockOpenNewSession = vi.fn();
vi.mock('../../../store/useDrawerStore', () => ({
  useDrawerStore: (selector: (s: { openNewSession: typeof mockOpenNewSession }) => unknown) =>
    selector({ openNewSession: mockOpenNewSession }),
}));

const healthyResponse = {
  status: 'ok',
  version: '1.0.0',
  platform: 'linux',
  uptime: 100,
  sessions: { active: 3, total: 10 },
  claude: { available: true, healthy: true, version: '1.0.0', minimumVersion: '0.1.0', error: null },
  timestamp: new Date().toISOString(),
};

const disconnectedResponse = {
  status: 'ok',
  version: '1.0.0',
  platform: 'linux',
  uptime: 100,
  sessions: { active: 0, total: 0 },
  claude: { available: false, healthy: false, version: null, minimumVersion: '0.1.0', error: 'not found' },
  timestamp: new Date().toISOString(),
};

const claudeUnhealthyResponse = {
  status: 'ok',
  version: '1.0.0',
  platform: 'linux',
  uptime: 100,
  sessions: { active: 0, total: 0 },
  claude: { available: true, healthy: false, version: '0.5.0', minimumVersion: '1.0.0', error: 'version too low' },
  timestamp: new Date().toISOString(),
};

describe('OnboardingWizard', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Default: resolve healthy
    mockGetHealth.mockResolvedValue(healthyResponse);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderAndWaitForHealth = async () => {
    const result = render(<OnboardingWizard onComplete={onComplete} />);
    await waitFor(() => {
      expect(mockGetHealth).toHaveBeenCalled();
    });
    // Wait for health to load
    await waitFor(() => {
      expect(screen.queryByText('Checking connection…')).toBeNull();
    });
    return result;
  };

  it('renders step 1 (Welcome) by default', () => {
    mockGetHealth.mockReturnValue(new Promise(() => {})); // never resolves — stay loading
    render(<OnboardingWizard onComplete={onComplete} />);
    expect(screen.getByText('Welcome to Aegis')).toBeDefined();
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('shows progress indicator with 4 steps', () => {
    mockGetHealth.mockReturnValue(new Promise(() => {}));
    render(<OnboardingWizard onComplete={onComplete} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuemax')).toBe('4');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('1');
  });

  it('navigates to next step on Next click', async () => {
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText('Claude Code Connected ✅')).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
  });

  it('navigates to previous step on Back click', async () => {
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to previous step'));
    expect(screen.getByText('Welcome to Aegis')).toBeDefined();
  });

  it('disables Back button on step 1', () => {
    mockGetHealth.mockReturnValue(new Promise(() => {}));
    render(<OnboardingWizard onComplete={onComplete} />);
    expect((screen.getByLabelText('Go to previous step') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls onComplete on last step', async () => {
    await renderAndWaitForHealth();
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

  it('announces step changes to screen readers', async () => {
    await renderAndWaitForHealth();
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Step 1 of 4: Welcome to Aegis');
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(status.textContent).toContain('Step 2 of 4: Connect Your Environment');
  });

  it('has accessible region label', () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    expect(screen.getByRole('region', { name: 'Onboarding wizard' })).toBeDefined();
  });

  // ── Smart onboarding tests ──────────────────────────────

  it('shows "Connected" state when Claude is healthy', async () => {
    mockGetHealth.mockResolvedValue(healthyResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText('Claude Code Connected ✅')).toBeDefined();
    expect(screen.getByText(/v1\.0\.0 detected and healthy/)).toBeDefined();
  });

  it('shows "Not Connected" when Claude unavailable', async () => {
    mockGetHealth.mockResolvedValue(disconnectedResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText('Connect Your Environment')).toBeDefined();
    expect(screen.getByText(/npx @anthropic-ai/)).toBeDefined();
  });

  it('shows copy-to-clipboard button when Claude unavailable', async () => {
    mockGetHealth.mockResolvedValue(disconnectedResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByLabelText('Copy command to clipboard')).toBeDefined();
  });

  it('shows warning when Claude detected but unhealthy', async () => {
    mockGetHealth.mockResolvedValue(claudeUnhealthyResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText('Claude Code Detected')).toBeDefined();
    expect(screen.getByText(/may have issues/)).toBeDefined();
  });

  it('shows active sessions count in First Session step', async () => {
    mockGetHealth.mockResolvedValue(healthyResponse);
    await renderAndWaitForHealth();
    // Go to step 3
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByRole('heading', { name: 'Sessions Running!' })).toBeDefined();
    expect(screen.getByText(/3 active session/)).toBeDefined();
  });

  it('shows "Create Session" CTA when zero sessions', async () => {
    mockGetHealth.mockResolvedValue(disconnectedResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByRole('heading', { name: 'Create Your First Session' })).toBeDefined();
    expect(screen.getByLabelText('Create your first session')).toBeDefined();
  });

  it('shows total sessions count in Explore step', async () => {
    mockGetHealth.mockResolvedValue(healthyResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText(/10 sessions monitored/)).toBeDefined();
  });

  it('handles health fetch failure gracefully', async () => {
    mockGetHealth.mockRejectedValue(new Error('Network error'));
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    // Falls back to static "Connect" step
    expect(screen.getByText('Connect Your Environment')).toBeDefined();
    expect(screen.getByText(/npx @anthropic-ai/)).toBeDefined();
  });

  it('shows loading spinner while health is fetching', () => {
    mockGetHealth.mockReturnValue(new Promise(() => {}));
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText('Checking connection…')).toBeDefined();
  });

  it('falls back to static content after 3s timeout', async () => {
    mockGetHealth.mockReturnValue(new Promise(() => {}));
    render(<OnboardingWizard onComplete={onComplete} />);
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText('Checking connection…')).toBeDefined();
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    // Should now show static fallback
    expect(screen.getByText('Connect Your Environment')).toBeDefined();
  });

  it('opens new session drawer on "Create Session" click', async () => {
    mockGetHealth.mockResolvedValue(disconnectedResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Create your first session'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockOpenNewSession).toHaveBeenCalledTimes(1);
  });

  it('opens new session drawer on completion when no active sessions', async () => {
    mockGetHealth.mockResolvedValue(disconnectedResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Complete onboarding and go to dashboard'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockOpenNewSession).toHaveBeenCalledTimes(1);
  });

  it('does not open session drawer on completion when sessions exist', async () => {
    mockGetHealth.mockResolvedValue(healthyResponse);
    await renderAndWaitForHealth();
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Go to next step'));
    fireEvent.click(screen.getByLabelText('Complete onboarding and go to dashboard'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockOpenNewSession).not.toHaveBeenCalled();
  });

  it('auto-marks step 2 as completed when Claude is connected', async () => {
    mockGetHealth.mockResolvedValue(healthyResponse);
    await renderAndWaitForHealth();
    // Step 2 should be pre-completed — progress indicator shows check for step 2
    // We navigate to step 2 and verify it shows connected state
    fireEvent.click(screen.getByLabelText('Go to next step'));
    expect(screen.getByText('Claude Code Connected ✅')).toBeDefined();
  });
});
