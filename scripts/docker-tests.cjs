const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, [path.resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/tools/executor-docker.test.ts', 'tests/eval', '--maxWorkers=1'], {
  stdio: 'inherit', env: { ...process.env, HARNESS_DOCKER_TESTS: '1' },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
