import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON ?? 'python';
const pythonClientDir = join(rootDir, 'packages', 'python-client');
const generatedModelsPath = join(
  'packages',
  'python-client',
  'src',
  'aegis_python_client',
  'models.py',
);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(python, ['-m', 'pip', 'install', '--quiet', '-e', `${pythonClientDir}[dev]`]);
run(process.execPath, [join(rootDir, 'scripts', 'generate-python-sdk.mjs')]);
run('git', ['diff', '--exit-code', '--', generatedModelsPath]);
