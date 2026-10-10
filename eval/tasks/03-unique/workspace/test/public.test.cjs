const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { unique } = require('../src/unique.cjs');
  assert.deepEqual(unique([1, 2, 1]), [1, 2]);
  assert.deepEqual(unique([1, '1', 1]), [1, '1']);
});
