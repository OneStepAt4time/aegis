const core = require('@actions/core');
const github = require('@actions/github');

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

async function run() {
  const token = core.getInput('github-token', { required: true });
  const title = core.getInput('issue-title', { required: true }).toLowerCase();
  const body = core.getInput('issue-body').toLowerCase();
  const issueNumber = core.getInput('issue-number', { required: true });
  const existingLabelsStr = core.getInput('existing-labels');

  const existingLabels = existingLabelsStr
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

  const text = `${title}\n${body}`;
  const labelsToAdd = [];

  // Apply area labels
  for (const { keywords, label } of AREA_KEYWORDS) {
    if (existingLabels.includes(label)) continue;
    if (keywords.some((kw) => text.includes(kw))) {
      labelsToAdd.push(label);
    }
  }

  // Apply priority labels (P2-P4 only, never P0 or P1)
  const existingPriority = existingLabels.find((l) => /^P[0-4]$/.test(l));
  if (!existingPriority) {
    for (const { keywords, label } of PRIORITY_KEYWORDS) {
      if (keywords.some((kw) => text.includes(kw))) {
        labelsToAdd.push(label);
        break; // Only one priority label
      }
    }
  }

  if (labelsToAdd.length === 0) {
    core.info('No labels to add');
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
}

run().catch((err) => {
  core.setFailed(err.message);
});
