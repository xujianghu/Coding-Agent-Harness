# 修复异步重试与最后一次异常

修复 src/retry.cjs 的异步 retry(fn,maxAttempts)。失败后继续调用，首次成功即返回结果；maxAttempts 为正整数，耗尽后抛出最后一次异常；fn 接收从 1 开始的尝试编号。无需等待或新增依赖。运行 npm test。
