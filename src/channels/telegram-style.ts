/**
 * channels/telegram-style.ts — Telegram Message Style Guide
 *
 * 6 standard message types for clean, consistent Telegram UX.
 * Rule: readable in 2 seconds. Max 2 button rows. Always an escape hatch.
 *
 * Types:
 *   ① quickUpdate  — one-liner (70% of messages)
 *   ② taskComplete — post-merge quality gate card
 *   ③ alert        — error/crash requiring action
 *   ④ yesNo        — binary question
 *   ⑤ decision     — technical choice with context + escape hatch
 *   ⑥ progress     — pipeline/deploy with ASCII progress bar
 */

// ── HTML Helpers (re-exported for channel use) ──────────────────────────────

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function bold(text: string): string {
  return `<b>${esc(text)}</b>`;
}

export function code(text: string): string {
  return `<code>${esc(text)}</code>`;
}

export function italic(text: string): string {
  return `<i>${esc(text)}</i>`;
}

// ── Types ───────────────────────────────────────────────────────────────────

/** Telegram inline keyboard button. */
export interface InlineButton {
  text: string;
  callback_data: string;
}

/** Styled message ready to send via Telegram API. */
export interface StyledMessage {
  text: string;
  parse_mode: 'HTML';
  reply_markup?: {
    inline_keyboard: InlineButton[][];
  };
}

// ── Status Emoji ────────────────────────────────────────────────────────────

export type StatusEmoji = '🟢' | '✅' | '⚠️' | '🔴' | '❌' | '🔄' | '🔨' | '🚀';

const STATUS_EMOJI: Record<string, StatusEmoji> = {
  ok: '🟢',
  done: '✅',
  warn: '⚠️',
  error: '🔴',
  fail: '❌',
  progress: '🔄',
  work: '🔨',
  deploy: '🚀',
};

export function statusEmoji(status: string): StatusEmoji {
  return STATUS_EMOJI[status] ?? '🔄';
}

// ── ① Quick Update ──────────────────────────────────────────────────────────

/**
 * One-liner status update. 70% of all messages.
 * No buttons, no separators. Emoji + text + optional data.
 */
export function quickUpdate(
  emoji: StatusEmoji | string,
  message: string,
): StyledMessage {
  return {
    text: `${emoji} ${esc(message)}`,
    parse_mode: 'HTML',
  };
}

/**
 * Quick update with inline code for technical data.
 * e.g. quickUpdateCode('🟢', 'CI verde su', 'main', '— 150/150 test ✅')
 */
export function quickUpdateCode(
  emoji: StatusEmoji | string,
  prefix: string,
  codeText: string,
  suffix?: string,
): StyledMessage {
  const parts = [emoji, esc(prefix), code(codeText)];
  if (suffix) parts.push(esc(suffix));
  return {
    text: parts.join(' '),
    parse_mode: 'HTML',
  };
}

// ── ② Task Complete ─────────────────────────────────────────────────────────

export interface TaskCompleteData {
  /** Issue/task reference, e.g. "issue-7" */
  taskRef: string;
  /** Short description */
  title: string;
  /** Duration string, e.g. "28 min" */
  duration: string;
  /** Branch name */
  branch: string;
  /** Quality gate results: [label, passed][] */
  checks: Array<[string, boolean]>;
  /** Optional PR URL */
  prUrl?: string;
}

/**
 * Post-merge/completion card with quality gate.
 * 3 lines max + 1 row of buttons.
 */
export function taskComplete(
  data: TaskCompleteData,
  buttons?: { merge?: string; review?: string; close?: string },
): StyledMessage {
  const checksStr = data.checks
    .map(([label, passed]) => `${passed ? '✅' : '❌'} ${esc(label)}`)
    .join(' · ');

  const text = [
    `✅ ${bold(data.taskRef)} — ${esc(data.title)}`,
    `⏱ ${code(data.duration)} · 🌿 ${code(data.branch)}`,
    checksStr,
  ].join('\n');

  const msg: StyledMessage = { text, parse_mode: 'HTML' };

  if (buttons) {
    const row: InlineButton[] = [];
    if (buttons.merge) row.push({ text: '✅ Merge', callback_data: buttons.merge });
    if (buttons.review) row.push({ text: '👀 Review', callback_data: buttons.review });
    if (buttons.close) row.push({ text: '❌ Chiudi', callback_data: buttons.close });
    if (row.length) msg.reply_markup = { inline_keyboard: [row] };
  }

  return msg;
}

// ── ③ Alert ─────────────────────────────────────────────────────────────────

export interface AlertData {
  /** Short title, e.g. "Session crash" */
  title: string;
  /** Session/resource id, e.g. "sess-4a7b" */
  resourceId: string;
  /** Technical details (max 3 lines, shown in monospace) */
  details: string;
}

export interface AlertButtons {
  restart?: string;
  log?: string;
  ignore?: string;
}

/**
 * Error/crash alert requiring action.
 * Monospace block for technical details + 1 row of buttons.
 */
export function alert(
  data: AlertData,
  buttons?: AlertButtons,
): StyledMessage {
  // Limit details to 3 lines
  const detailLines = data.details.split('\n').slice(0, 3).join('\n');

  const text = [
    `🔴 ${bold(data.title)} — ${code(data.resourceId)}`,
    `<pre>${esc(detailLines)}</pre>`,
  ].join('\n');

  const msg: StyledMessage = { text, parse_mode: 'HTML' };

  if (buttons) {
    const row: InlineButton[] = [];
    if (buttons.restart) row.push({ text: '🔄 Riavvia', callback_data: buttons.restart });
    if (buttons.log) row.push({ text: '📜 Log', callback_data: buttons.log });
    if (buttons.ignore) row.push({ text: '⏸ Ignora', callback_data: buttons.ignore });
    if (row.length) msg.reply_markup = { inline_keyboard: [row] };
  }

  return msg;
}

// ── ④ Yes/No ────────────────────────────────────────────────────────────────

/**
 * Binary question. 2 buttons, zero ambiguity.
 * The "no" label should describe what happens if declined.
 */
export function yesNo(
  question: string,
  yesLabel: string,
  noLabel: string,
  yesCallback: string,
  noCallback: string,
): StyledMessage {
  return {
    text: esc(question),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: `✅ ${yesLabel}`, callback_data: yesCallback },
          { text: `❌ ${noLabel}`, callback_data: noCallback },
        ],
      ],
    },
  };
}

// ── ⑤ Decision ──────────────────────────────────────────────────────────────

export interface DecisionOption {
  emoji: string;
  label: string;
  description: string;
  callback: string;
}

/**
 * Technical decision with context + escape hatch.
 * The ONLY type allowed 2 rows of buttons.
 * Max 3 options + always "Decidi tu" / "Parliamone".
 */
export function decision(
  question: string,
  options: DecisionOption[],
  escapeCallbacks?: { decideTu?: string; parliamone?: string },
): StyledMessage {
  const opts = options.slice(0, 3); // Max 3

  const optionLines = opts.map(
    (o) => `${bold(o.label)} — ${esc(o.description)}`,
  );

  const text = [esc(question), '', ...optionLines].join('\n');

  const optionRow: InlineButton[] = opts.map((o) => ({
    text: `${o.emoji} ${o.label}`,
    callback_data: o.callback,
  }));

  const escapeRow: InlineButton[] = [];
  if (escapeCallbacks?.decideTu) {
    escapeRow.push({ text: '🤷 Decidi tu', callback_data: escapeCallbacks.decideTu });
  }
  if (escapeCallbacks?.parliamone) {
    escapeRow.push({ text: '💬 Parliamone', callback_data: escapeCallbacks.parliamone });
  }

  const keyboard: InlineButton[][] = [optionRow];
  if (escapeRow.length) keyboard.push(escapeRow);

  return {
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  };
}

// ── ⑥ Progress ──────────────────────────────────────────────────────────────

export interface ProgressStep {
  label: string;
  /** Duration string if done, e.g. "2.1s" */
  duration?: string;
  done: boolean;
}

/**
 * Progress/pipeline card with ASCII bar.
 * Updates via editMessageText — never send a new message for refresh.
 */
export function progress(
  title: string,
  steps: ProgressStep[],
  percent: number,
  buttons?: { pause?: string; cancel?: string },
): StyledMessage {
  const doneSteps = steps.filter((s) => s.done);
  const currentStep = steps.find((s) => !s.done);

  // Done steps on one line with · separator
  const doneStr = doneSteps
    .map((s) => `✅ ${esc(s.label)}${s.duration ? ' ' + code(s.duration) : ''}`)
    .join(' · ');

  // ASCII progress bar
  const barLen = 14;
  const filled = Math.round((percent / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  const lines: string[] = [
    `🔄 ${bold(title)}`,
  ];
  if (doneStr) lines.push(doneStr);
  if (currentStep) lines.push(`🔄 ${esc(currentStep.label)}...`);
  lines.push(`${code(bar)} ${percent}%`);

  const msg: StyledMessage = { text: lines.join('\n'), parse_mode: 'HTML' };

  if (buttons) {
    const row: InlineButton[] = [];
    if (buttons.pause) row.push({ text: '⏸ Pausa', callback_data: buttons.pause });
    if (buttons.cancel) row.push({ text: '❌ Annulla', callback_data: buttons.cancel });
    if (row.length) msg.reply_markup = { inline_keyboard: [row] };
  }

  return msg;
}
