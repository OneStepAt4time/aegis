import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON ?? 'python';
const outputPath = join(
  rootDir,
  'packages',
  'python-client',
  'src',
  'aegis_python_client',
  'models.py',
);

const args = [
  '-m',
  'datamodel_code_generator',
  '--input',
  join(rootDir, 'openapi.yaml'),
  '--input-file-type',
  'openapi',
  '--output',
  outputPath,
  '--output-model-type',
  'pydantic_v2.BaseModel',
  '--target-python-version',
  '3.10',
  '--formatters',
  'black',
  'isort',
  '--disable-timestamp',
];

const result = spawnSync(python, args, { cwd: rootDir, stdio: 'inherit' });
if (result.error) {
  console.error(`Failed to run Python SDK generator: ${result.error.message}`);
  console.error('Install generator dependencies with: python -m pip install -e "packages/python-client[dev]"');
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
