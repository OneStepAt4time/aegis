import { useState } from 'react';
import { ChevronDown, Copy, Check } from 'lucide-react';
import { useT } from '../../i18n/context.js';

export interface CliShortcutsPanelProps {
  sessionId: string;
  createdAt?: number;
}

interface Command {
  labelKey: string;
  fullCmd: string;
  displayCmd: string;
}

export function CliShortcutsPanel({ sessionId, createdAt }: CliShortcutsPanelProps) {
  const t = useT();
  const isNew = createdAt != null && Date.now() - createdAt < 60_000;
  const [open, setOpen] = useState(isNew);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const shortId = sessionId.slice(0, 8);

  const commands: Command[] = [
    { labelKey: 'cliShortcuts.viewOutput',  fullCmd: `ag read ${sessionId}`,   displayCmd: `ag read ${shortId}`   },
    { labelKey: 'cliShortcuts.streamLive',  fullCmd: `ag tail ${sessionId}`,   displayCmd: `ag tail ${shortId}`   },
    { labelKey: 'cliShortcuts.checkStatus', fullCmd: `ag status ${sessionId}`, displayCmd: `ag status ${shortId}` },
    { labelKey: 'cliShortcuts.killSession', fullCmd: `ag kill ${sessionId}`,   displayCmd: `ag kill ${shortId}`   },
    { labelKey: 'cliShortcuts.listAll',     fullCmd: 'ag list',                displayCmd: 'ag list'              },
  ];

  const handleCopy = async (cmd: Command) => {
    try {
      await navigator.clipboard.writeText(cmd.fullCmd);
      setCopiedKey(cmd.labelKey);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Clipboard API unavailable (non-HTTPS mobile) — fail silently
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        aria-expanded={open}
        aria-label={t('cliShortcuts.title')}
      >
        <span>{t('cliShortcuts.title')}</span>
        <ChevronDown
          className={`h-4 w-4 text-[var(--color-text-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-[var(--color-void-lighter)] p-3 space-y-1">
          {commands.map((cmd) => {
            const isCopied = copiedKey === cmd.labelKey;
            return (
              <div key={cmd.labelKey} className="flex items-center gap-2 rounded px-1 py-1">
                <span className="w-28 shrink-0 text-xs text-[var(--color-text-muted)]">
                  {t(cmd.labelKey)}
                </span>
                <code
                  className="flex-1 truncate rounded bg-[var(--color-void)] px-2 py-0.5 font-mono text-xs text-[var(--color-text-primary)]"
                  title={cmd.fullCmd}
                >
                  {cmd.displayCmd}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(cmd)}
                  aria-label={isCopied ? t('cliShortcuts.copied') : t('cliShortcuts.copy')}
                  className="flex min-h-[28px] items-center justify-center gap-1 rounded px-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)] hover:text-[var(--color-text-primary)]"
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
                      <span className="text-[var(--color-success)]">{t('cliShortcuts.copied')}</span>
                    </>
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
