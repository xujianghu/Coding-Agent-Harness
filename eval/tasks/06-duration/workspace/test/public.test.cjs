const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { formatDuration } = require('../src/index.cjs');
  assert.equal(formatDuration(125), '2:05');
});
