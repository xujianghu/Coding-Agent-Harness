const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  const success=await rpc.retry('retry.cjs',[{error:'temporary'},{value:42}],3); assert.equal(success.value,42); assert.deepEqual(success.attempts,[1,2]);
  await assert.rejects(rpc.retry('retry.cjs',[{error:'earlier1'},{error:'earlier2'},{error:'last'}],3),error=>{assert.equal(error.message,'last'); assert.deepEqual(error.attempts,[1,2,3]); return true;});
  const first=await rpc.retry('retry.cjs',[{value:1}],3); assert.equal(first.value,1); assert.deepEqual(first.attempts,[1]);
  await assert.rejects(rpc.retry('retry.cjs',[{value:1}],0),RangeError);
};
