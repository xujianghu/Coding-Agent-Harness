const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  const items=[{tag:'__proto__',id:1},{tag:'toString',id:2},{tag:'__proto__',id:3}]; const response=await rpc.invoke('group.cjs','groupBy',[items,'tag']); const output=response.value;
  assert.equal(Object.getPrototypeOf(output),null); assert.deepEqual(output.__proto__.map(value=>value.id),[1,3]); assert.equal(output.toString[0],response.argsAfter[0][1]); assert.deepEqual(response.argsAfter[0],items);
  assert.equal(Object.keys(await rpc.call('group.cjs','groupBy',[[],'tag'])).length,0);
  assert.equal((await rpc.call('group.cjs','groupBy',[[{tag:'constructor'}],'tag'])).constructor.length,1);
};
