# 修复 CSV 字段转义

修复 src/escape.cjs 的 escapeCell：值先转字符串，含逗号、双引号、CR 或 LF 时用双引号包裹，内部每个双引号变成两个。src/csv.cjs 使用此函数拼接行，请保持不变。运行 npm test。
