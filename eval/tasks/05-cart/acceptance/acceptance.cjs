const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  assert.equal(await rpc.call('money.cjs','toCents',[1.239]),124);
  assert.equal(await rpc.call('cart.cjs','cartTotal',[[]]),0);
  const lines=[{price:1.239,quantity:2},{price:0.5,quantity:0},{price:2.5,quantity:1}];
  const response=await rpc.invoke('cart.cjs','cartTotal',[lines]); assert.equal(response.value,4.98); assert.deepEqual(response.argsAfter[0],lines);
};
