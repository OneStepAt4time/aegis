import type { Page } from '@playwright/test';

const TEST_TOKEN = 'e2e-test-token';

/**
 * Authenticate the dashboard through the current memory-only token flow.
 * The helper replays login on every full document load so tests can safely
 * navigate with page.goto() without losing auth state.
 * Required before navigating to protected pages in smoke tests.
 */
export async function authenticate(page: Page): Promise<void> {
  await page.addInitScript((token: string) => {
    const startedAt = Date.now();

    const tryAutoLogin = () => {
      const input = document.querySelector('#token, input[name="token"]');
      const button = Array.from(document.querySelectorAll('button'))
        .find(candidate => /sign in/i.test(candidate.textContent ?? ''));

      if (!(input instanceof HTMLInputElement) || !(button instanceof HTMLButtonElement)) {
        if (Date.now() - startedAt < 10_000) {
          window.setTimeout(tryAutoLogin, 50);
        }
        return;
      }

      const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      nativeValueSetter?.call(input, token);
      input.dispatchEvent(new Event('input', { bubbles: true }));

      if (button.disabled) {
        if (Date.now() - startedAt < 10_000) {
          window.setTimeout(tryAutoLogin, 50);
        }
        return;
      }

      button.click();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        window.setTimeout(tryAutoLogin, 0);
      }, { once: true });
      return;
    }

    window.setTimeout(tryAutoLogin, 0);
  }, TEST_TOKEN);
  await page.route('**/v1/auth/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, role: 'admin' }),
    });
  });
}
