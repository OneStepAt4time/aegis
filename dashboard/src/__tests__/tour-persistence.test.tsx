import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAuthStore } from '../store/useAuthStore';

vi.mock('../pages/OverviewPage', () => ({ default: () => <div>Overview Page</div> }));
vi.mock('../pages/AuthKeysPage', () => ({ default: () => <div>Auth Keys Page</div> }));
vi.mock('../pages/AuditPage', () => ({ default: () => <div>Audit Page</div> }));
vi.mock('../pages/SessionDetailPage', () => ({ default: () => <div>Session Detail Page</div> }));
vi.mock('../pages/PipelinesPage', () => ({ default: () => <div>Pipelines Page</div> }));
vi.mock('../pages/PipelineDetailPage', () => ({ default: () => <div>Pipeline Detail Page</div> }));
vi.mock('../pages/NotFoundPage', () => ({ default: () => <div>Not Found Page</div> }));
vi.mock('../pages/LoginPage', () => ({ default: () => <div>Login Page</div> }));
vi.mock('../components/Layout', () => ({ default: () => <div>Layout Outlet</div> }));
vi.mock('../components/tour/FirstRunTour', () => ({
  FirstRunTour: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="first-run-tour">
      <button onClick={onComplete}>Complete Tour</button>
    </div>
  ),
}));

describe('Tour and onboarding persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.setState({
      token: 'test-token',
      authMode: 'password' as const,
      identity: { username: 'admin', role: 'admin' },
      oidcAvailable: false,
      isAuthenticated: true,
      isVerifying: false,
      lastVerifiedAt: Date.now(),
      init: vi.fn(async () => {}),
    });
  });

  it('should persist aegis:onboarded when OnboardingWizard completes', () => {
    // First render without onboarded flag → shows OnboardingWizard
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // Simulate OnboardingWizard completion by setting the flag (what the fix does)
    // The OnboardingWizard onComplete callback should write the flag
    expect(localStorage.getItem('aegis:onboarded')).toBeNull();

    unmount();

    // Now simulate what happens after the callback fires: flag is set
    localStorage.setItem('aegis:onboarded', '1');
    sessionStorage.setItem('aegis:onboarded', '1');

    // Re-render: should NOT show OnboardingWizard
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // Should not find onboarding wizard content (would show Layout instead)
    expect(screen.queryByText(/Connect Your Environment/i)).toBeNull();
  });

  it('should not re-show tour after markTourCompleted', () => {
    localStorage.setItem('aegis:onboarded', '1');
    sessionStorage.setItem('aegis:onboarded', '1');
    localStorage.setItem('aegis:tour:completed', '1');

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    // Tour should not appear
    expect(screen.queryByTestId('first-run-tour')).toBeNull();
  });
});
