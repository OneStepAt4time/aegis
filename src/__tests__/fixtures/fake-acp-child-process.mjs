import process from 'node:process';

const mode = process.env.FAKE_ACP_CHILD_MODE ?? 'echo';

if (mode === 'print-env') {
  const payload = {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    customEnv: process.env.ACP_CHILD_TEST_VALUE,
    providerEnv: process.env.ANTHROPIC_AUTH_TOKEN === 'synthetic-token',
    noColor: process.env.NO_COLOR,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.stderr.write('fixture stderr ready\n');
  process.exit(0);
}

if (mode === 'stream') {
  process.stdout.write('stdout-one\n');
  setTimeout(() => process.stdout.write('stdout-two\n'), 10);
  process.stderr.write('stderr-one\n');
  setTimeout(() => process.stderr.write('stderr-two\n'), 20);
  setTimeout(() => process.exit(0), 40);
}

if (mode === 'exit-nonzero') {
  process.stderr.write('fatal fixture exit\n');
  setTimeout(() => process.exit(7), 20);
}

if (mode === 'wait-for-stdin-close') {
  process.stdout.write('ready\n');
  process.stdin.resume();
  process.stdin.on('end', () => {
    process.stdout.write('stdin closed\n');
    process.exit(0);
  });
}

if (mode === 'long-running') {
  process.stdout.write('ready\n');
  setInterval(() => undefined, 1_000);
}
