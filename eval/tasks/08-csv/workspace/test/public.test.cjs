const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { csvRow } = require('../src/csv.cjs');
  assert.equal(csvRow(['a,b', 'c"d']), '"a,b","c""d"');
});
