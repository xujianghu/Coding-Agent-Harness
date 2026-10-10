# 定位路径分隔符归一化

修复 src/utils/path.cjs 的 normalizePath(value)：把所有反斜杠转换为 /，连续斜杠合并为一个，保留大小写和开头、结尾的单个斜杠，空字符串保持空字符串。入口 src/index.cjs 不得修改。运行 npm test。
