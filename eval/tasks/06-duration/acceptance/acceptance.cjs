const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  for (const [value,out] of [[0,'0:00'],[59,'0:59'],[60,'1:00'],[125,'2:05'],[1500,'25:00']]) assert.equal(await rpc.call('index.cjs','formatDuration',[value]),out);
  for (const value of [-1,0.5]) await assert.rejects(rpc.call('index.cjs','formatDuration',[value]),RangeError);
};
