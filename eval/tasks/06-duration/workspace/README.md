# 定位持续时间格式错误

入口 src/index.cjs 的 formatDuration(minutes) 应把非负整数分钟格式化为 H:MM（如 125 -> 2:05），小时允许超过 24，非法输入抛出 RangeError。定位实际实现并只修改 src/lib/duration.cjs，保持入口接口。运行 npm test。
