const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { clamp } = require('../src/clamp.cjs');
  assert.equal(clamp(5, 0, 10), 5);
});
