import { describe, it, expect } from 'vitest';

// Extract the pure logic from index.js for unit testing
// We test the keyword matching and label selection logic directly

const AREA_KEYWORDS = [
  { keywords: ['dashboard', 'ui', 'frontend'], label: 'dashboard' },
  { keywords: ['backend', 'api', 'fastify'], label: 'backend' },
  { keywords: ['mcp', 'stdio'], label: 'mcp' },
  { keywords: ['ci', 'github actions'], label: 'ci' },
  { keywords: ['security', 'auth', 'token'], label: 'security' },
  { keywords: ['performance', 'latency'], label: 'performance' },
  { keywords: ['docs', 'readme'], label: 'documentation' },
  { keywords: ['test', 'vitest'], label: 'tests' },
  { keywords: ['tmux', 'session'], label: 'tmux' },
  { keywords: ['platform', 'windows', 'linux', 'macos'], label: 'platform' },
];

const PRIORITY_KEYWORDS = [
  {
    keywords: ['feature', 'enhancement', 'new', 'add support', 'implement'],
    label: 'P2',
  },
  {
    keywords: ['nice to have', 'could', 'would be nice', 'low priority', 'backlog'],
    label: 'P3',
  },
  {
    keywords: ['minor', 'trivial', 'typo', 'cosmetic', 'nit', 'cleanup'],
    label: 'P4',
  },
];

function computeLabels(title, body, existingLabels) {
  const text = `${title}\n${body}`.toLowerCase();
  const labelsToAdd = [];

  for (const { keywords, label } of AREA_KEYWORDS) {
    if (existingLabels.includes(label)) continue;
    if (keywords.some((kw) => text.includes(kw))) {
      labelsToAdd.push(label);
    }
  }

  const existingPriority = existingLabels.find((l) => /^P[0-4]$/.test(l));
  if (!existingPriority) {
    for (const { keywords, label } of PRIORITY_KEYWORDS) {
      if (keywords.some((kw) => text.includes(kw))) {
        labelsToAdd.push(label);
        break;
      }
    }
  }

  return labelsToAdd;
}

// --- Area label tests ---

describe('area labels', () => {
  it('labels dashboard issues', () => {
    const labels = computeLabels('Add new dashboard widget', '', []);
    expect(labels).toContain('dashboard');
  });

  it('labels backend issues', () => {
    const labels = computeLabels('Fix API endpoint', '', []);
    expect(labels).toContain('backend');
  });

  it('labels MCP issues', () => {
    const labels = computeLabels('MCP server crash', '', []);
    expect(labels).toContain('mcp');
  });

  it('labels CI issues', () => {
    const labels = computeLabels('CI pipeline broken', '', []);
    expect(labels).toContain('ci');
  });

  it('labels security issues', () => {
    const labels = computeLabels('Auth token validation', '', []);
    expect(labels).toContain('security');
  });

  it('labels performance issues', () => {
    const labels = computeLabels('High latency on startup', '', []);
    expect(labels).toContain('performance');
  });

  it('labels documentation issues', () => {
    const labels = computeLabels('Update README', '', []);
    expect(labels).toContain('documentation');
  });

  it('labels test issues', () => {
    const labels = computeLabels('Add vitest coverage', '', []);
    expect(labels).toContain('tests');
  });

  it('labels tmux issues', () => {
    const labels = computeLabels('tmux session management', '', []);
    expect(labels).toContain('tmux');
  });

  it('labels platform issues', () => {
    const labels = computeLabels('Windows support', '', []);
    expect(labels).toContain('platform');
  });

  it('matches keywords in issue body', () => {
    const labels = computeLabels('Bug in the app', 'The backend api returns 500', []);
    expect(labels).toContain('backend');
  });

  it('matches multiple area labels', () => {
    const labels = computeLabels('Security fix for API', '', []);
    expect(labels).toContain('security');
    expect(labels).toContain('backend');
  });
});

// --- Priority label tests ---

describe('priority labels', () => {
  it('labels feature requests as P2', () => {
    const labels = computeLabels('Feature: add new export option', '', []);
    expect(labels).toContain('P2');
  });

  it('labels enhancements as P2', () => {
    const labels = computeLabels('Enhancement: improve logging', '', []);
    expect(labels).toContain('P2');
  });

  it('labels nice-to-have as P3', () => {
    const labels = computeLabels('Nice to have: dark mode', '', []);
    expect(labels).toContain('P3');
  });

  it('labels backlog items as P3', () => {
    const labels = computeLabels('Move to backlog: refactor utils', '', []);
    expect(labels).toContain('P3');
  });

  it('labels minor issues as P4', () => {
    const labels = computeLabels('Minor typo in error message', '', []);
    expect(labels).toContain('P4');
  });

  it('labels trivial issues as P4', () => {
    const labels = computeLabels('Trivial: fix spacing', '', []);
    expect(labels).toContain('P4');
  });

  it('never auto-applies P0', () => {
    const labels = computeLabels('Critical system is down', '', []);
    expect(labels).not.toContain('P0');
  });

  it('never auto-applies P1', () => {
    const labels = computeLabels('Urgent: production is broken', '', []);
    expect(labels).not.toContain('P1');
  });

  it('only applies one priority label', () => {
    const labels = computeLabels('Feature: minor enhancement', '', []);
    const priorities = labels.filter((l) => /^P[0-4]$/.test(l));
    expect(priorities).toHaveLength(1);
  });
});

// --- Existing label preservation ---

describe('existing labels', () => {
  it('does not override existing area labels', () => {
    const labels = computeLabels('Dashboard widget broken', '', ['dashboard']);
    expect(labels).not.toContain('dashboard');
  });

  it('does not override existing priority labels', () => {
    const labels = computeLabels('Feature request', '', ['P1']);
    const priorities = labels.filter((l) => /^P[0-4]$/.test(l));
    expect(priorities).toHaveLength(0);
  });

  it('adds labels when none exist', () => {
    const labels = computeLabels('New feature for the backend', '', []);
    expect(labels.length).toBeGreaterThan(0);
  });

  it('returns empty when no keywords match', () => {
    const labels = computeLabels('Something happened', '', []);
    expect(labels).toHaveLength(0);
  });
});
