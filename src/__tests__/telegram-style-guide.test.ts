/**
 * telegram-style-guide.test.ts — Tests for the 6 standard message types.
 *
 * Validates:
 * - Each type produces valid HTML
 * - Button constraints (max rows, escape hatch)
 * - Length/readability rules
 * - Emoji consistency
 */

import { describe, it, expect } from 'vitest';
import {
  quickUpdate,
  quickUpdateCode,
  taskComplete,
  alert,
  yesNo,
  decision,
  progress,
  esc,
  bold,
  code,
  statusEmoji,
  type StyledMessage,
  type InlineButton,
} from '../channels/telegram-style.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function buttonRows(msg: StyledMessage): InlineButton[][] {
  return msg.reply_markup?.inline_keyboard ?? [];
}

function textLines(msg: StyledMessage): string[] {
  return msg.text.split('\n').filter((l) => l.trim());
}

function hasNoSeparators(msg: StyledMessage): boolean {
  return !msg.text.includes('━') && !msg.text.includes('───') && !msg.text.includes('▬');
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('HTML helpers', () => {
  it('esc escapes HTML entities', () => {
    expect(esc('<b>&test</b>')).toBe('&lt;b&gt;&amp;test&lt;/b&gt;');
  });

  it('bold wraps in <b> and escapes content', () => {
    expect(bold('hello <world>')).toBe('<b>hello &lt;world&gt;</b>');
  });

  it('code wraps in <code> and escapes content', () => {
    expect(code('a & b')).toBe('<code>a &amp; b</code>');
  });

  it('statusEmoji returns correct emoji', () => {
    expect(statusEmoji('ok')).toBe('🟢');
    expect(statusEmoji('error')).toBe('🔴');
    expect(statusEmoji('done')).toBe('✅');
    expect(statusEmoji('unknown')).toBe('🔄'); // default
  });
});

describe('① Quick Update', () => {
  it('produces a one-liner', () => {
    const msg = quickUpdate('🟢', 'CI verde su main — 150/150 test');
    expect(textLines(msg).length).toBe(1);
  });

  it('has no buttons', () => {
    const msg = quickUpdate('✅', 'All tests passed');
    expect(msg.reply_markup).toBeUndefined();
  });

  it('has no separators', () => {
    const msg = quickUpdate('🔨', 'PR merged');
    expect(hasNoSeparators(msg)).toBe(true);
  });

  it('starts with emoji', () => {
    const msg = quickUpdate('🚀', 'Deployed v1.0.5');
    expect(msg.text.startsWith('🚀')).toBe(true);
  });

  it('escapes HTML in message', () => {
    const msg = quickUpdate('⚠️', 'Error in <script> tag');
    expect(msg.text).toContain('&lt;script&gt;');
  });

  it('quickUpdateCode formats inline code', () => {
    const msg = quickUpdateCode('🟢', 'CI verde su', 'main', '— 150/150 test ✅');
    expect(msg.text).toContain('<code>main</code>');
    expect(textLines(msg).length).toBe(1);
  });

  it('parse_mode is always HTML', () => {
    expect(quickUpdate('🟢', 'test').parse_mode).toBe('HTML');
  });
});

describe('② Task Complete', () => {
  const data = {
    taskRef: 'issue-7',
    title: 'Session timeout config',
    duration: '28 min',
    branch: 'feat/session-timeout',
    checks: [
      ['tsc', true],
      ['build', true],
      ['152/152 test', true],
    ] as [string, boolean][],
  };

  it('fits in 3 lines of text', () => {
    const msg = taskComplete(data);
    expect(textLines(msg).length).toBeLessThanOrEqual(3);
  });

  it('has max 1 row of buttons', () => {
    const msg = taskComplete(data, { merge: 'merge', review: 'review', close: 'close' });
    expect(buttonRows(msg).length).toBeLessThanOrEqual(1);
  });

  it('shows ✅ for passed checks', () => {
    const msg = taskComplete(data);
    expect(msg.text).toContain('✅ tsc');
    expect(msg.text).toContain('✅ build');
  });

  it('shows ❌ for failed checks', () => {
    const failData = { ...data, checks: [['tsc', false], ['build', true]] as [string, boolean][] };
    const msg = taskComplete(failData);
    expect(msg.text).toContain('❌ tsc');
  });

  it('has no separators', () => {
    expect(hasNoSeparators(taskComplete(data))).toBe(true);
  });

  it('starts with ✅ emoji', () => {
    expect(taskComplete(data).text.startsWith('✅')).toBe(true);
  });

  it('has no buttons when none specified', () => {
    const msg = taskComplete(data);
    expect(msg.reply_markup).toBeUndefined();
  });
});

describe('③ Alert', () => {
  const data = {
    title: 'Session crash',
    resourceId: 'sess-4a7b',
    details: 'Exit 137 (OOM) · task: issue-12\nLast output: 3m ago',
  };

  it('starts with 🔴', () => {
    expect(alert(data).text.startsWith('🔴')).toBe(true);
  });

  it('uses <pre> for technical details', () => {
    expect(alert(data).text).toContain('<pre>');
  });

  it('limits details to 3 lines', () => {
    const longDetails = 'line1\nline2\nline3\nline4\nline5';
    const msg = alert({ ...data, details: longDetails });
    const preContent = msg.text.match(/<pre>([\s\S]*?)<\/pre>/)?.[1] ?? '';
    expect(preContent.split('\n').length).toBeLessThanOrEqual(3);
  });

  it('has max 1 row of buttons', () => {
    const msg = alert(data, { restart: 'r', log: 'l', ignore: 'i' });
    expect(buttonRows(msg).length).toBeLessThanOrEqual(1);
  });

  it('has no separators', () => {
    expect(hasNoSeparators(alert(data))).toBe(true);
  });
});

describe('④ Yes/No', () => {
  const msg = yesNo(
    'Il test fallisce. Skippo e creo issue?',
    'Sì',
    'No, fixxa ora',
    'yes_skip',
    'no_fix',
  );

  it('has exactly 1 row of 2 buttons', () => {
    expect(buttonRows(msg).length).toBe(1);
    expect(buttonRows(msg)[0].length).toBe(2);
  });

  it('yes button has ✅ prefix', () => {
    expect(buttonRows(msg)[0][0].text).toContain('✅');
  });

  it('no button has ❌ prefix', () => {
    expect(buttonRows(msg)[0][1].text).toContain('❌');
  });

  it('text is short (no separators, no blocks)', () => {
    expect(hasNoSeparators(msg)).toBe(true);
    expect(msg.text).not.toContain('<pre>');
    expect(msg.text).not.toContain('<blockquote');
  });

  it('escapes HTML in question', () => {
    const m = yesNo('Delete <all> files?', 'Yes', 'No', 'y', 'n');
    expect(m.text).toContain('&lt;all&gt;');
  });
});

describe('⑤ Decision', () => {
  const options = [
    { emoji: '🏗', label: 'Strategy', description: 'Clean, testable', callback: 'strategy' },
    { emoji: '🔌', label: 'Plugin', description: 'Extensible, complex', callback: 'plugin' },
  ];

  it('has max 2 rows of buttons (options + escape)', () => {
    const msg = decision('Which pattern?', options, { decideTu: 'dt', parliamone: 'p' });
    expect(buttonRows(msg).length).toBeLessThanOrEqual(2);
  });

  it('second row has escape hatch buttons', () => {
    const msg = decision('Which?', options, { decideTu: 'dt', parliamone: 'p' });
    const rows = buttonRows(msg);
    expect(rows[1].some((b) => b.text.includes('Decidi tu'))).toBe(true);
    expect(rows[1].some((b) => b.text.includes('Parliamone'))).toBe(true);
  });

  it('limits to 3 options max', () => {
    const manyOptions = [
      ...options,
      { emoji: '🎯', label: 'C', description: 'Third', callback: 'c' },
      { emoji: '🔥', label: 'D', description: 'Fourth (should be cut)', callback: 'd' },
    ];
    const msg = decision('Which?', manyOptions);
    expect(buttonRows(msg)[0].length).toBeLessThanOrEqual(3);
  });

  it('has no escape row if not provided', () => {
    const msg = decision('Which?', options);
    expect(buttonRows(msg).length).toBe(1);
  });

  it('has no separators', () => {
    expect(hasNoSeparators(decision('Q?', options))).toBe(true);
  });

  it('option descriptions use bold label', () => {
    const msg = decision('Q?', options);
    expect(msg.text).toContain('<b>Strategy</b>');
    expect(msg.text).toContain('<b>Plugin</b>');
  });
});

describe('⑥ Progress', () => {
  const steps = [
    { label: 'tsc', duration: '2.1s', done: true },
    { label: 'build', duration: '4.3s', done: true },
    { label: 'test', duration: '8.7s', done: true },
    { label: 'restart service', done: false },
  ];

  it('has ASCII progress bar', () => {
    const msg = progress('Deploy v1.0.5', steps, 85);
    expect(msg.text).toContain('█');
    expect(msg.text).toContain('░');
  });

  it('shows percentage', () => {
    const msg = progress('Deploy', steps, 85);
    expect(msg.text).toContain('85%');
  });

  it('starts with 🔄', () => {
    expect(progress('Deploy', steps, 50).text.startsWith('🔄')).toBe(true);
  });

  it('shows done steps with ✅', () => {
    const msg = progress('Deploy', steps, 75);
    expect(msg.text).toContain('✅ tsc');
    expect(msg.text).toContain('✅ build');
  });

  it('shows current step with 🔄', () => {
    const msg = progress('Deploy', steps, 85);
    // The current (not done) step
    expect(msg.text).toContain('🔄 restart service...');
  });

  it('has max 1 row of buttons', () => {
    const msg = progress('Deploy', steps, 85, { pause: 'p', cancel: 'c' });
    expect(buttonRows(msg).length).toBeLessThanOrEqual(1);
  });

  it('has no separators', () => {
    expect(hasNoSeparators(progress('Deploy', steps, 85))).toBe(true);
  });

  it('progress bar length is 14 chars', () => {
    const msg = progress('Deploy', steps, 50);
    const barMatch = stripHtml(msg.text).match(/[█░]{10,}/);
    expect(barMatch).not.toBeNull();
    expect(barMatch![0].length).toBe(14);
  });

  it('0% shows all empty', () => {
    const msg = progress('Deploy', [{ label: 'start', done: false }], 0);
    expect(msg.text).toContain('░'.repeat(14));
  });

  it('100% shows all filled', () => {
    const msg = progress('Deploy', [{ label: 'done', done: true, duration: '1s' }], 100);
    expect(msg.text).toContain('█'.repeat(14));
  });
});

describe('Global constraints', () => {
  it('all types use parse_mode HTML', () => {
    const messages: StyledMessage[] = [
      quickUpdate('🟢', 'test'),
      taskComplete({ taskRef: 't', title: 'x', duration: '1m', branch: 'b', checks: [] }),
      alert({ title: 'err', resourceId: 'r', details: 'd' }),
      yesNo('q?', 'y', 'n', 'yc', 'nc'),
      decision('q?', [{ emoji: '🏗', label: 'A', description: 'd', callback: 'a' }]),
      progress('p', [{ label: 's', done: false }], 50),
    ];
    for (const msg of messages) {
      expect(msg.parse_mode).toBe('HTML');
    }
  });

  it('no type exceeds 2 button rows (except decision which allows 2)', () => {
    const messages: StyledMessage[] = [
      taskComplete(
        { taskRef: 't', title: 'x', duration: '1m', branch: 'b', checks: [] },
        { merge: 'm', review: 'r', close: 'c' },
      ),
      alert({ title: 'e', resourceId: 'r', details: 'd' }, { restart: 'r', log: 'l', ignore: 'i' }),
      yesNo('q?', 'y', 'n', 'yc', 'nc'),
      progress('p', [{ label: 's', done: false }], 50, { pause: 'p', cancel: 'c' }),
    ];
    for (const msg of messages) {
      expect(buttonRows(msg).length).toBeLessThanOrEqual(2);
    }
  });

  it('no type uses separators', () => {
    const messages: StyledMessage[] = [
      quickUpdate('🟢', 'test'),
      taskComplete({ taskRef: 't', title: 'x', duration: '1m', branch: 'b', checks: [] }),
      alert({ title: 'e', resourceId: 'r', details: 'd' }),
      yesNo('q?', 'y', 'n', 'yc', 'nc'),
      decision('q?', [{ emoji: '🏗', label: 'A', description: 'd', callback: 'a' }]),
      progress('p', [{ label: 's', done: false }], 50),
    ];
    for (const msg of messages) {
      expect(hasNoSeparators(msg)).toBe(true);
    }
  });
});
