const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  for (const [v,min,max,out] of [[-5,0,10,0],[12,0,10,10],[5,0,10,5],[0,0,0,0],[-4,-8,-2,-4]]) assert.equal(await rpc.call('clamp.cjs','clamp',[v,min,max]),out);
  await assert.rejects(rpc.call('clamp.cjs','clamp',[1,3,2]),RangeError);
};
