# 修复折扣计算

修复 src/discount.cjs 的 discounted(price, percent)。percent 表示优惠百分比（20 表示八折），金额四舍五入保留两位小数。保留 0 到 100 的校验与 RangeError。运行 npm test。
