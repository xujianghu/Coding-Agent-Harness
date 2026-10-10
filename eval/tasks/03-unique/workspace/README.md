# 保留类型的稳定去重

修复 src/unique.cjs 的 unique(values)。按 JavaScript Set 的相等语义稳定去重：数字 1 与字符串 "1" 不同，NaN 只保留一个，同一对象引用去重但不同对象均保留，且不修改输入。运行 npm test。
