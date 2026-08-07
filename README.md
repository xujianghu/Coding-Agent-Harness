# Coding Agent Harness

从零构建的 TypeScript CLI 编码智能体，纯命令行工具（无 WebUI），通过 LLM 驱动自动执行编码任务，内置多层治理护栏保障执行安全。

```
┌─────────────────────────────────────────────────────┐
│                     CLI (harness)                    │
├─────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────────────────────────────┐ │
│  │  Config  │  │          Agent 主循环              │ │
│  │  Loader  │  │  Prompt → LLM → Parse → Execute   │ │
│  └──────────┘  └──────────┬───────────────────────┘ │
│                           │                          │
│  ┌────────────────────────┼────────────────────────┐ │
│  │           Governance Pipeline                   │ │
│  │  Guardrail → HITL → Sandbox → Audit             │ │
│  └────────────────────────┼────────────────────────┘ │
│                           │                          │
│  ┌──────────┐  ┌──────────┼──────────┐  ┌─────────┐ │
│  │  Memory  │  │       Tools          │  │   LLM   │ │
│  │  Store   │  │ File | Shell | Test  │  │ Mock    │ │
│  │ Retriever│  │   Lint | Registry    │  │ OpenAI  │ │
│  └──────────┘  └─────────────────────┘  │ Anthropic│ │
│                                          │ Gemini   │ │
│  ┌──────────────────────────────────┐    └─────────┘ │
│  │  Feedback Loop                   │                │
│  │  Runner → Parser → Injector      │                │
│  └──────────────────────────────────┘                │
└─────────────────────────────────────────────────────┘
```

## 快速开始

```bash
# 1. 安装
npm install -g coding-agent-harness

# 2. 配置 API Key
harness key set openai

# 3. 执行任务
harness run "创建一个 package.json 文件"
```

## 安装指南

- **Node.js** >= 20
- 全局安装：`npm install -g coding-agent-harness`
- 本地安装：`git clone <repo> && npm install && npm run build`

## 使用说明

### `harness run <task>`

执行编码任务。Agent 会读取当前工作目录，调用 LLM 分析任务，并依次执行工具操作。

```bash
harness run "创建一个 TypeScript 工具函数"
harness run -c .harness/config.yaml -w ./my-project "修复所有 lint 错误"
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-c, --config <path>` | 配置文件路径 | `.harness/config.yaml` |
| `-w, --workspace <path>` | 工作区根路径 | 当前目录 |

### `harness key set <provider>`

配置 API Key，交互式输入，输入内容不会回显在终端。

```bash
harness key set openai      # 配置 OpenAI
harness key set anthropic   # 配置 Anthropic
harness key set gemini      # 配置 Gemini
```

### `harness key status`

查看各 Provider 的 Key 配置状态。

```
$ harness key status
API Key Status:
  openai: configured
  anthropic: not configured
  gemini: not configured
```

### `harness key clear <provider>`

删除指定 Provider 的 API Key，需二次确认。

```bash
harness key clear openai
```

## Key 安全配置

- 所有 API Key 存储在 `.harness/credentials/credentials.json`，该路径已加入 `.gitignore`
- 输入 Key 时**终端不回显明文**
- `harness key status` 只显示 `configured` / `not configured`，**绝不输出明文 Key**
- 推荐配合环境变量注入方案使用（后续版本支持）

## 分发方式

### Docker

```bash
docker build -t coding-agent-harness .
docker run -it -v $(pwd):/workspace coding-agent-harness run "你的任务"
```

### npm

```bash
npm install -g coding-agent-harness
harness run "你的任务"
```

## 目录结构

```
src/core/         # Agent 主循环 + 核心类型
src/llm/          # LLM 抽象层（Mock + OpenAI + Anthropic + Gemini）
src/tools/        # 工具系统（注册表 + 文件/Shell/测试/Lint）
src/governance/   # 治理护栏（护栏引擎 + HITL + 沙箱 + 管道 + 审计）
src/feedback/     # 反馈闭环（执行器 + 解析器 + 回灌器）
src/memory/       # 记忆系统（存储 + 检索）
src/config/       # 配置系统
src/credential/   # 凭据管理
src/cli/          # CLI 入口
tests/            # 单元测试（mock LLM 驱动）
demo/             # 机制演示脚本
```

## 安全边界说明

以下操作会被**自动拦截**（无需人工确认）：

| 拦截操作 | 规则 |
|----------|------|
| `rm -rf /` | 禁止递归删除根目录 |
| `git push --force` | 禁止 force push |
| `git reset --hard` | 禁止硬重置 |
| `curl \| bash` | 禁止管道执行远程脚本 |
| `chmod 777` | 禁止危险权限修改 |
| 写入沙箱外路径 | 路径白名单校验 |

以下操作需要**人工审批**：

| 审批操作 | 规则 |
|----------|------|
| `sudo ...` | 需要 HITL 人工确认 |

治理管道执行顺序：**Guardrail（正则匹配）→ HITL（人工审批）→ Sandbox（路径/命令白名单）→ Audit（审计日志）**。

## 已知限制

- 纯 CLI 工具，无 WebUI
- 需要 Node.js 20+
- 凭据存储为本地 JSON 文件（`.harness/credentials/credentials.json`）
- 护栏规则为静态正则匹配，不支持语义分析
- 当前仅 Mock LLM 驱动 Agent 主循环，真实 LLM 适配预览中

## 开发指南

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 运行测试
npm test

# 运行机制演示
npm run demo

# 本地执行
npm start run "你的任务"
```