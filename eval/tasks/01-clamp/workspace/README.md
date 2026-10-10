# 修复边界裁剪

修复 src/clamp.cjs 的 clamp(value, min, max)：小于下界返回 min，大于上界返回 max，区间内保持原值。保留原有导出和非法区间的 RangeError。运行 npm test。
