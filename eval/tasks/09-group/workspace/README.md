# 修复特殊键的分组

修复 src/group.cjs 的 groupBy(items,key)：返回无原型对象，按每个 item[key] 的字符串值分组并保留原始顺序，支持 __proto__、constructor、toString 等键，不修改输入。运行 npm test。
