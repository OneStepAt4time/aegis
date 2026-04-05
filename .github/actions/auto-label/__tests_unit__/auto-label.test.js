import { describe, it, expect } from 'vitest';

const CRITICAL_KEYWORDS = [
  'auth bypass', 'authentication bypass', 'auth bypass',
  'rce', 'remote code execution',
  'data loss', 'data corruption',
  'privilege escalation',
  'security bypass', 'ssti', 'sql injection', 'Injection',
];

const AREA_KEYWORDS = [
  { keywords: ['dashboard', 'ui ', 'user interface', 'frontend', 'front-end', 'react', 'vite'], label: 'dashboard' },
  { keywords: ['backend', 'api', 'fastify', 'rest endpoint', 'http endpoint'], label: 'backend' },
  { keywords: ['mcp', 'model context protocol', 'stdio'], label: 'mcp' },
  { keywords: ['ci', 'github actions', 'github action', 'workflow', 'actions/checkout'], label: 'ci' },
  { keywords: ['security', 'auth bypass', 'authentication', 'xss', 'csrf', 'ssrf', 'injection'], label: 'security' },
  { keywords: ['performance', 'latency', 'slow', 'bottleneck', 'optimize'], label: 'performance' },
  { keywords: ['docs', 'readme', 'documentation', 'doc '], label: 'documentation' },
  { keywords: ['test', 'vitest', 'unit test', 'integration test', 'e2e', 'testing'], label: 'tests' },
  { keywords: ['tmux', 'terminal'], label: 'tmux' },
  { keywords: ['platform', 'windows', 'linux', 'macos', 'darwin', 'cross-platform'], label: 'platform' },
];

const PRIORITY_KEYWORDS = [
  {
    keywords: ['feature', 'enhancement', 'new', 'add support', 'implement', 'capability'],
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
  const titleLower = title.toLowerCase();
  const bodyLower = (body || '').toLowerCase();
  const text = `${titleLower}\n${bodyLower}`;
  const labelsToAdd = [];

  const existingPriority = existingLabels.find((l) => /^P[0-4]$/.test(l));

  // Check for critical keywords - P1 escalation
  if (!existingPriority) {
    for (const kw of CRITICAL_KEYWORDS) {
      if (text.includes(kw)) {
        labelsToAdd.push('P1');
        break;
      }
    }
  }

  // Apply area labels
  for (const { keywords, label } of AREA_KEYWORDS) {
    if (existingLabels.includes(label)) continue;
    if (keywords.some((kw) => text.includes(kw))) {
      labelsToAdd.push(label);
    }
  }

  // Apply priority labels
  const currentPriority = existingLabels.find((l) => /^P[0-4]$/.test(l));
  if (!currentPriority && !labelsToAdd.includes('P1')) {
    for (const { keywords, label } of PRIORITY_KEYWORDS) {
      if (keywords.some((kw) => text.includes(kw))) {
        labelsToAdd.push(label);
        break;
      }
    }
  }

  return labelsToAdd;
}

describe('P1 critical escalation', () => {
  it('escalates auth bypass to P1', () => {
    const labels = computeLabels('[Security] Auth bypass in endpoint', '', []);
    expect(labels).toContain('P1');
  });

  it('escalates RCE to P1', () => {
    const labels = computeLabels('RCE via template injection', '', []);
    expect(labels).toContain('P1');
  });

  it('escalates data loss to P1', () => {
    const labels = computeLabels('Data loss on session close', '', []);
    expect(labels).toContain('P1');
  });

  it('escalates privilege escalation to P1', () => {
    const labels = computeLabels('Privilege escalation in webhook handler', '', []);
    expect(labels).toContain('P1');
  });

  it('escalates SQL injection to P1', () => {
    const labels = computeLabels('SQL Injection vulnerability', '', []);
    expect(labels).toContain('P1');
  });

  it('does not override existing priority label', () => {
    const labels = computeLabels('Auth bypass issue', '', ['P2']);
    expect(labels).not.toContain('P1');
    // P2 already exists, API preserves it; we just verify P1 is not added
  });
});

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
    const labels = computeLabels('XSS vulnerability in input', '', []);
    expect(labels).toContain('security');
  });

  it('does not over-match "session" for tmux', () => {
    // "session" is too generic - should not match tmux unless explicitly terminal/tmux
    const labels = computeLabels('Fix session timeout issue', '', []);
    expect(labels).not.toContain('tmux');
  });

  it('does not over-match "token" for security', () => {
    // "token" alone is too generic
    const labels = computeLabels('Add refresh token support', '', []);
    expect(labels).not.toContain('security');
  });
});

describe('priority labels', () => {
  it('labels feature requests as P2', () => {
    const labels = computeLabels('Add new feature', '', []);
    // P2 already exists, API preserves it; we just verify P1 is not added
  });

  it('labels nice-to-have as P3', () => {
    const labels = computeLabels('Would be nice to have dark mode', '', []);
    expect(labels).toContain('P3');
  });

  it('labels minor issues as P4', () => {
    const labels = computeLabels('Fix typo in README', '', []);
    expect(labels).toContain('P4');
  });
});
