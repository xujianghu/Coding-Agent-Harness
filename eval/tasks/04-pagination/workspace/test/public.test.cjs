const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { paginate } = require('../src/pagination.cjs');
  assert.deepEqual(paginate([1,2,3,4,5], 1, 2), [1,2]);
});
