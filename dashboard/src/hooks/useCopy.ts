import { useCallback, useState } from 'react';

export function useCopy(value: string, _label?: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    const doWrite = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(doWrite).catch(() => {
        execCommandFallback(value, doWrite);
      });
    } else {
      execCommandFallback(value, doWrite);
    }
  }, [value]);

  return { copied, copy };
}

function execCommandFallback(text: string, onSuccess: () => void): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) onSuccess();
  } catch {
    // silently fail
  }
}
