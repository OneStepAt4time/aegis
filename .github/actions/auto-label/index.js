const core = require('@actions/core');
const github = require('@actions/github');

// Critical keywords that warrant P1 auto-escalation
const CRITICAL_KEYWORDS = [
  'auth bypass', 'authentication bypass', 'auth bypass',
  'rce', 'remote code execution',
  'data loss', 'data corruption',
  'privilege escalation', 'privilege escalation',
  'security bypass', 'ssti', 'sql injection', 'Injection',
  '信息泄露', '数据泄露',  // Chinese: data breach
];

// Area keywords with improved specificity to reduce false positives
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

async function run() {
  const token = core.getInput('github-token', { required: true });
  const title = core.getInput('issue-title', { required: true });
  const body = core.getInput('issue-body');
  const issueNumber = core.getInput('issue-number', { required: true });
  const existingLabelsStr = core.getInput('existing-labels');

  const existingLabels = existingLabelsStr
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const titleLower = title.toLowerCase();
  const bodyLower = (body || '').toLowerCase();
  const text = `${titleLower}\n${bodyLower}`;
  const labelsToAdd = [];
  const appliedRules = [];

  // Check for critical security signals first - P1 escalation
  const existingPriority = existingLabels.find((l) => /^P[0-4]$/.test(l));
  if (!existingPriority) {
    for (const kw of CRITICAL_KEYWORDS) {
      if (text.includes(kw)) {
        labelsToAdd.push('P1');
        appliedRules.push(`critical: "${kw}" matched -> P1`);
        core.info(`Critical keyword detected: "${kw}" - escalating to P1`);
        break;
      }
    }
  }

  // Apply area labels (only if not already present)
  for (const { keywords, label } of AREA_KEYWORDS) {
    if (existingLabels.includes(label)) continue;
    if (keywords.some((kw) => text.includes(kw))) {
      labelsToAdd.push(label);
      appliedRules.push(`area: matched keywords [${keywords.join(', ')}] -> ${label}`);
    }
  }

  // Apply priority labels (P2-P4 only, never override P0/P1)
  const currentPriority = existingLabels.find((l) => /^P[0-4]$/.test(l));
  if (!currentPriority && !labelsToAdd.includes('P1')) {
    for (const { keywords, label } of PRIORITY_KEYWORDS) {
      if (keywords.some((kw) => text.includes(kw))) {
        labelsToAdd.push(label);
        appliedRules.push(`priority: matched [${keywords.join(', ')}] -> ${label}`);
        break; // Only one priority label
      }
    }
  }

  if (labelsToAdd.length === 0) {
    core.info('No labels to add');
    core.info('Applied rules: none (no match)');
    return;
  }

  const octokit = github.getOctokit(token);
  const repo = github.context.repo;

  await octokit.rest.issues.addLabels({
    ...repo,
    issue_number: parseInt(issueNumber, 10),
    labels: labelsToAdd,
  });

  core.info(`Added labels: ${labelsToAdd.join(', ')}`);
  core.info(`Applied rules: ${appliedRules.join(' | ')}`);
}

run().catch((err) => {
  core.setFailed(err.message);
});
