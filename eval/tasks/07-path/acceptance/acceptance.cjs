const assert = require('node:assert/strict');

// 隐藏断言仅在可信父进程执行，候选只收到函数参数和结构化回调描述。
module.exports = async function acceptance(rpc) {
  for (const [value,out] of [['a\\b\\c','a/b/c'],['a//b///c','a/b/c'],['/A//B/','/A/B/'],['',''],['abc','abc']]) assert.equal(await rpc.call('index.cjs','normalizePath',[value]),out);
};
