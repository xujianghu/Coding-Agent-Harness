const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { normalizePath } = require('../src/index.cjs');
  assert.equal(normalizePath('a\\b\\c'), 'a/b/c');
});
