const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  const values=[1,2,3,4,5];
  for (const [page,expected] of [[1,[1,2]],[2,[3,4]],[3,[5]],[4,[]]]) { const response=await rpc.invoke('pagination.cjs','paginate',[values,page,2]); assert.deepEqual(response.value,expected); assert.deepEqual(response.argsAfter[0],values); }
  for (const [page,size] of [[0,2],[1,0],[1.5,2],[1,1.5]]) await assert.rejects(rpc.call('pagination.cjs','paginate',[values,page,size]),RangeError);
};
