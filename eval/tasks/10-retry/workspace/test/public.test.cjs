const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { retry } = require('../src/retry.cjs');
  assert.equal(await retry(async attempt => { if (attempt<2) throw new Error('temporary'); return 42; }, 3),42);
});
