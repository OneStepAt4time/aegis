const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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
    assert.ok(labels.includes('dashboard'));
  });

  it('labels backend issues', () => {
    const labels = computeLabels('Fix API endpoint', '', []);
    assert.ok(labels.includes('backend'));
  });

  it('labels MCP issues', () => {
    const labels = computeLabels('MCP server crash', '', []);
    assert.ok(labels.includes('mcp'));
  });

  it('labels CI issues', () => {
    const labels = computeLabels('CI pipeline broken', '', []);
    assert.ok(labels.includes('ci'));
  });

  it('labels security issues', () => {
    const labels = computeLabels('Auth token validation', '', []);
    assert.ok(labels.includes('security'));
  });

  it('labels performance issues', () => {
    const labels = computeLabels('High latency on startup', '', []);
    assert.ok(labels.includes('performance'));
  });

  it('labels documentation issues', () => {
    const labels = computeLabels('Update README', '', []);
    assert.ok(labels.includes('documentation'));
  });

  it('labels test issues', () => {
    const labels = computeLabels('Add vitest coverage', '', []);
    assert.ok(labels.includes('tests'));
  });

  it('labels tmux issues', () => {
    const labels = computeLabels('tmux session management', '', []);
    assert.ok(labels.includes('tmux'));
  });

  it('labels platform issues', () => {
    const labels = computeLabels('Windows support', '', []);
    assert.ok(labels.includes('platform'));
  });

  it('matches keywords in issue body', () => {
    const labels = computeLabels('Bug in the app', 'The backend api returns 500', []);
    assert.ok(labels.includes('backend'));
  });

  it('matches multiple area labels', () => {
    const labels = computeLabels('Security fix for API', '', []);
    assert.ok(labels.includes('security'));
    assert.ok(labels.includes('backend'));
  });
});

// --- Priority label tests ---

describe('priority labels', () => {
  it('labels feature requests as P2', () => {
    const labels = computeLabels('Feature: add new export option', '', []);
    assert.ok(labels.includes('P2'));
  });

  it('labels enhancements as P2', () => {
    const labels = computeLabels('Enhancement: improve logging', '', []);
    assert.ok(labels.includes('P2'));
  });

  it('labels nice-to-have as P3', () => {
    const labels = computeLabels('Nice to have: dark mode', '', []);
    assert.ok(labels.includes('P3'));
  });

  it('labels backlog items as P3', () => {
    const labels = computeLabels('Move to backlog: refactor utils', '', []);
    assert.ok(labels.includes('P3'));
  });

  it('labels minor issues as P4', () => {
    const labels = computeLabels('Minor typo in error message', '', []);
    assert.ok(labels.includes('P4'));
  });

  it('labels trivial issues as P4', () => {
    const labels = computeLabels('Trivial: fix spacing', '', []);
    assert.ok(labels.includes('P4'));
  });

  it('never auto-applies P0', () => {
    const labels = computeLabels('Critical system is down', '', []);
    assert.ok(!labels.includes('P0'));
  });

  it('never auto-applies P1', () => {
    const labels = computeLabels('Urgent: production is broken', '', []);
    assert.ok(!labels.includes('P1'));
  });

  it('only applies one priority label', () => {
    const labels = computeLabels('Feature: minor enhancement', '', []);
    const priorities = labels.filter((l) => /^P[0-4]$/.test(l));
    assert.equal(priorities.length, 1);
  });
});

// --- Existing label preservation ---

describe('existing labels', () => {
  it('does not override existing area labels', () => {
    const labels = computeLabels('Dashboard widget broken', '', ['dashboard']);
    assert.ok(!labels.includes('dashboard'));
  });

  it('does not override existing priority labels', () => {
    const labels = computeLabels('Feature request', '', ['P1']);
    const priorities = labels.filter((l) => /^P[0-4]$/.test(l));
    assert.equal(priorities.length, 0);
  });

  it('adds labels when none exist', () => {
    const labels = computeLabels('New feature for the backend', '', []);
    assert.ok(labels.length > 0);
  });

  it('returns empty when no keywords match', () => {
    const labels = computeLabels('Something happened', '', []);
    assert.equal(labels.length, 0);
  });
});
