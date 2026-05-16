/**
 * clipboard.ts — Robust copy-to-clipboard with textarea fallback.
 *
 * Uses `navigator.clipboard.writeText` when available (HTTPS / localhost).
 * Falls back to programmatic textarea selection + execCommand("copy")
 * for older browsers and insecure contexts (e.g. plain HTTP on mobile).
 */

/**
 * Copy `text` to the system clipboard.
 * Returns `true` if the copy succeeded, `false` otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern Clipboard API first
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // NotAllowedError or other failure — fall through to textarea fallback
    }
  }

  // Textarea fallback for insecure contexts / old browsers
  return textareaCopy(text);
}

function textareaCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;

  // Position off-screen to avoid visual flash
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let success = false;
  try {
    success = document.execCommand('copy');
  } catch {
    success = false;
  }

  document.body.removeChild(textarea);
  return success;
}
