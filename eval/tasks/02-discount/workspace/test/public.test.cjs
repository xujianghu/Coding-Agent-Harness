const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { discounted } = require('../src/discount.cjs');
  assert.equal(discounted(100, 20), 80);
});
