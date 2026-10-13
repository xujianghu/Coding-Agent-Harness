const test = require('node:test');
const assert = require('node:assert/strict');
test('公开回归测试', async () => {
  const { cartTotal } = require('../src/cart.cjs');
  assert.equal(cartTotal([{price: 2.5, quantity: 3}]), 7.5);
});
