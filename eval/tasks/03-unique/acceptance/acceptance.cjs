const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  const object={}; const other={}; const input=[object,other,object,NaN,NaN,0,-0];
  const response=await rpc.invoke('unique.cjs','unique',[input]); const output=response.value;
  assert.equal(output.length,4); assert.equal(output[0],response.argsAfter[0][0]); assert.equal(output[1],response.argsAfter[0][1]); assert.ok(Number.isNaN(output[2])); assert.deepEqual(response.argsAfter[0],input);
  assert.deepEqual(await rpc.call('unique.cjs','unique',[[1,'1',1]]),[1,'1']);
  assert.deepEqual(await rpc.call('unique.cjs','unique',[[]]),[]);
};
