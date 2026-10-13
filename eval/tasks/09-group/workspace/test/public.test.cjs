const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { groupBy } = require('../src/group.cjs');
  const result=groupBy([{tag:'constructor'}], 'tag');
  assert.equal(result.constructor.length, 1);
});
