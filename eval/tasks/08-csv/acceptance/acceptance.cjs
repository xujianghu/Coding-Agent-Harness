const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  assert.equal(await rpc.call('escape.cjs','escapeCell',['a\nb']),'"a\nb"'); assert.equal(await rpc.call('escape.cjs','escapeCell',['a\rb']),'"a\rb"');
  assert.equal(await rpc.call('csv.cjs','csvRow',[[12,'plain','""']]),'12,plain,""""""'); assert.equal(await rpc.call('csv.cjs','csvRow',[[]]),'');
  assert.equal(await rpc.call('csv.cjs','csvRow',[['a,b','c"d']]),'"a,b","c""d"');
};
