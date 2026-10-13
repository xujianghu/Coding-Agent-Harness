# 修复购物车数量与金额换算

修复 src/cart.cjs 和 src/money.cjs：toCents(amount) 四舍五入换算为分；cartTotal(lines) 对每行先转分再乘 quantity，求和后返回元，空购物车为 0，不修改输入。运行 npm test。
