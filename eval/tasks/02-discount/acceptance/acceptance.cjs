const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  for (const [price,discount,out] of [[100,20,80],[37.5,0,37.5],[37.5,100,0],[12.34,15,10.49]]) assert.equal(await rpc.call('discount.cjs','discounted',[price,discount]),out);
  for (const percent of [-1,101]) await assert.rejects(rpc.call('discount.cjs','discounted',[5,percent]),RangeError);
};
