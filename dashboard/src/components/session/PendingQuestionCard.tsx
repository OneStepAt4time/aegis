import type { PendingQuestionInfo } from '../../types';

interface PendingQuestionCardProps {
  pendingQuestion: PendingQuestionInfo;
  onSelectOption?: (option: string) => void;
}

export function PendingQuestionCard({
  pendingQuestion,
  onSelectOption,
}: PendingQuestionCardProps) {
  return (
    <div className="rounded-lg border border-[var(--color-info)]/30 bg-[var(--color-info-bg)]/60 p-3">
      <div className="flex flex-col gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-accent-cyan)]">
            Claude needs an answer
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-primary)]">
            {pendingQuestion.content}
          </p>
        </div>

        {pendingQuestion.options && pendingQuestion.options.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingQuestion.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onSelectOption?.(option)}
                className="min-h-[40px] rounded-full border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20"
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400">
          Reply below to keep the session moving.
        </p>
      </div>
    </div>
  );
}
