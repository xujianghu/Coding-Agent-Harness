# 修复从第一页开始的分页

修复 src/pagination.cjs 的 paginate(items, page, size)：page 从 1 开始，返回对应页，超出范围返回空数组。保留正整数校验、不修改输入。运行 npm test。
