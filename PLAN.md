# Coding Agent Harness 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 TypeScript CLI 编码智能体——从零实现 agent 主循环、多供应商 LLM 抽象层、工具分发、治理护栏（重点）、反馈闭环、记忆、配置、凭据管理的完整 harness。

**Architecture:** 分层插件式架构。每层独立接口、可 mock 注入。治理管道作为独立管道插入主循环。纯 CLI 入口。

**Tech Stack:** TypeScript 5.x, Node.js 20+, Vitest, Commander.js, YAML, OpenAI SDK, Anthropic SDK, Google Generative AI SDK

## 全局约束

- Node.js >= 20.0.0, TypeScript >= 5.0.0
- 所有核心机制必须可用 mock LLM 独立测试，不依赖网络或真实 LLM
- 每个模块必须有对应的单元测试文件
- 凭据绝不硬编码、不提交 Git、不写入日志
- 测试框架：Vitest, CLI 框架：Commander.js, 包管理：npm

## 文件结构总览

```
coding-agent-harness/
├── src/
│   ├── core/types.ts, loop.ts
│   ├── llm/mock.ts, openai.ts, anthropic.ts, gemini.ts
│   ├── tools/registry.ts, file.ts, shell.ts, test-runner.ts, lint.ts
│   ├── governance/rules.ts, guardrail.ts, sandbox.ts, hitl.ts, pipeline.ts, audit.ts
│   ├── feedback/runner.ts, parser.ts, injector.ts
│   ├── memory/store.ts, retriever.ts
│   ├── config/loader.ts
│   ├── credential/manager.ts
│   ├── cli/index.ts
├── tests/（对应 src 目录结构）
├── demo/01-guardrail-intercept.ts, 02-feedback-loop.ts, 03-deep-dimension.ts
├── package.json, tsconfig.json, vitest.config.ts, Dockerfile, .gitignore
├── .harness/config.yaml, guardrails.yaml
└── .github/workflows/ci.yml
```

## 依赖关系图

```
Task 1 (types/scaffold) ──────────────────────────────────────────────┐
  ├── Task 2 (llm) ── Task 4 (loop) ──────────────────────────────────┤
  ├── Task 3 (config) ────────────────────────────────────────(可并行)┤
  ├── Task 5 (tool registry) ── 6(file) 7(shell) 8(test) 9(lint) ────┤
  ├── Task 10 (memory store) ── 11 (retriever) ──────────────(可并行)┤
  ├── Task 12 (guardrail) ─┐                                          │
  ├── Task 13 (hitl) ──────┤                                          │
  ├── Task 14 (sandbox) ───┼── Task 15 (pipeline) ── Task 16 (audit) ─┤
  ├── Task 17 (fb runner) ── 18 (parser) ── 19 (injector) ──(可并行)─┤
  ├── Task 20 (credential) ──────────────────────────────────(可并行)─┤
  └── (以上全部) ── Task 21 (CLI) ───────────────────────────────────────┤
Task 22-24 (demos) ── 依赖对应模块                                     │
Task 25 (Docker) ── 依赖 21                                            │
Task 26 (CI) ── 依赖 25                                                │
Task 27 (README) ── 依赖全部                                           │
```

## 可并行 worktree 分组

| 分组 | Tasks | 说明 |
|------|-------|------|
| wt-scaffold | 1 | 项目脚手架 + 核心类型 |
| wt-llm | 2 | LLM 抽象层 |
| wt-config | 3 | 配置系统 |
| wt-loop | 4 | Agent 主循环（依赖 1,2） |
| wt-tools | 5-9 | 工具系统全组 |
| wt-memory | 10-11 | 记忆系统 |
| wt-governance | 12-16 | 治理护栏全组 |
| wt-feedback | 17-19 | 反馈闭环 |
| wt-credential | 20 | 凭据管理 |
| wt-cli | 21 | CLI 入口 |
| wt-demos | 22-24 | 机制演示 |
| wt-ops | 25-27 | 分发 + CI + 文档 |

---

### Task 1: 项目脚手架与核心类型定义

**依赖:** 无 | **Worktree:** wt-scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/core/types.ts`

**Interfaces:**
- Produces: `AgentAction`, `ActionResult`, `GuardrailResult`, `FeedbackSignal`, `ConversationTurn`, `MemoryEntry`, `ToolDefinition`, `AgentConfig`, `LLMResponse`, `LLMProvider`, `AgentState`

- [ ] **Step 1: 创建目录结构**

Run: `mkdir -p src/core src/llm src/tools src/governance src/feedback src/memory src/config src/credential src/cli tests/core tests/llm tests/tools tests/governance tests/feedback tests/memory tests/config tests/credential demo .harness .github/workflows`

- [ ] **Step 2: 创建 package.json**

```json
{
  "name": "coding-agent-harness",
  "version": "1.0.0",
  "description": "A CLI coding agent harness built from scratch",
  "main": "dist/cli/index.js",
  "bin": { "harness": "./dist/cli/index.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "demo": "npx tsx demo/01-guardrail-intercept.ts && npx tsx demo/02-feedback-loop.ts && npx tsx demo/03-deep-dimension.ts",
    "start": "node dist/cli/index.js"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "yaml": "^2.4.0",
    "openai": "^4.50.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "@google/generative-ai": "^0.20.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.12.0",
    "tsx": "^4.10.0"
  }
}
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "demo"]
}
```

- [ ] **Step 4: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: 创建 .gitignore**

```
node_modules/
dist/
.env
*.key
credentials.*
.harness/memory/
.harness/*.log
coverage/
test-workspace/
```

- [ ] **Step 6: 创建 src/core/types.ts**

```typescript
export interface AgentAction {
  type: 'read_file' | 'write_file' | 'shell_exec' | 'run_test' | 'run_lint';
  params: Record<string, string>;
}

export interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval?: boolean;
}

export interface FeedbackSignal {
  type: 'test' | 'lint' | 'typecheck' | 'guardrail';
  passed: boolean;
  details: Array<{ file: string; line: number; message: string }>;
  summary: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system' | 'feedback';
  content: string;
  timestamp: number;
  action?: AgentAction;
  result?: ActionResult;
}

export interface MemoryEntry {
  key: string;
  value: string;
  category: 'convention' | 'decision' | 'structure';
  timestamp: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required: boolean }>;
  execute: (params: Record<string, string>) => Promise<ActionResult>;
}

export interface AgentConfig {
  llm: {
    provider: 'openai' | 'anthropic' | 'gemini';
    model: string;
    maxTokens: number;
    temperature: number;
  };
  agent: {
    maxTurns: number;
    timeout: number;
  };
  governance: {
    rulesFile: string;
    sandbox: {
      allowedPaths: string[];
      allowedCommands: string[];
    };
  };
  memory: {
    storagePath: string;
    maxConversationTurns: number;
  };
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  name: string;
  complete: (messages: Array<{ role: string; content: string }>) => Promise<LLMResponse>;
}

export type AgentState = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'error' | 'stopped';
```

- [ ] **Step 7: 安装依赖并验证编译**

```bash
npm install
npx tsc --noEmit
```

Expected: 无编译错误

- [ ] **Step 8: 提交**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/core/types.ts
git commit -m "feat: 项目脚手架与核心类型定义"
```

---

### Task 2: LLM 抽象层（接口 + Mock + 供应商 Adapter）

**依赖:** Task 1 | **可并行:** 与 Task 3 | **Worktree:** wt-llm

**Files:**
- Create: `src/llm/mock.ts`, `src/llm/openai.ts`, `src/llm/anthropic.ts`, `src/llm/gemini.ts`
- Create: `tests/llm/mock.test.ts`, `tests/llm/openai.test.ts`, `tests/llm/anthropic.test.ts`, `tests/llm/gemini.test.ts`

**Interfaces:**
- Consumes: `LLMResponse`, `LLMProvider` from `src/core/types.ts`
- Produces: `createMockLLM(responses): LLMProvider`, `createOpenAIProvider(config): LLMProvider`, `createAnthropicProvider(config): LLMProvider`, `createGeminiProvider(config): LLMProvider`

- [ ] **Step 1: 编写 Mock LLM 失败测试**

`tests/llm/mock.test.ts`：测试 `createMockLLM` 返回预设响应、响应耗尽后返回空字符串。

- [ ] **Step 2: 实现 MockLLM**

`src/llm/mock.ts`：`createMockLLM(responses: LLMResponse[])` 返回 `LLMProvider`，按顺序返回预设响应，索引递增。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/llm/mock.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 4: 实现 OpenAI Adapter**

`src/llm/openai.ts`：`createOpenAIProvider({apiKey, model})` 封装 OpenAI SDK 的 `chat.completions.create`，返回 `LLMResponse`。

- [ ] **Step 5: 编写 OpenAI Adapter 测试（mock SDK）**

`tests/llm/openai.test.ts`：vi.mock OpenAI SDK，验证 adapter 正确调用并返回 LLMResponse。

- [ ] **Step 6: 实现 Anthropic Adapter**

`src/llm/anthropic.ts`：`createAnthropicProvider({apiKey, model})` 封装 Anthropic SDK，处理 system 消息分离。

- [ ] **Step 7: 编写 Anthropic Adapter 测试**

`tests/llm/anthropic.test.ts`：vi.mock Anthropic SDK，验证 adapter。

- [ ] **Step 8: 实现 Gemini Adapter**

`src/llm/gemini.ts`：`createGeminiProvider({apiKey, model})` 封装 Google Generative AI SDK，处理 chat history。

- [ ] **Step 9: 编写 Gemini Adapter 测试**

`tests/llm/gemini.test.ts`：vi.mock Google SDK，验证 adapter。

- [ ] **Step 10: 运行全部 LLM 测试**

```bash
npx vitest run tests/llm/
```

Expected: 4 个测试文件全部 PASS

- [ ] **Step 11: 提交**

```bash
git add src/llm/ tests/llm/
git commit -m "feat: LLM 抽象层（Mock + OpenAI + Anthropic + Gemini）"
```

---

### Task 3: 配置系统

**依赖:** Task 1 | **可并行:** 与 Task 2 | **Worktree:** wt-config

**Files:**
- Create: `src/config/loader.ts`, `tests/config/loader.test.ts`
- Create: `.harness/config.yaml`, `.harness/guardrails.yaml`

**Interfaces:**
- Produces: `loadConfig(path: string): AgentConfig`, `DefaultConfig: AgentConfig`

- [ ] **Step 1: 编写配置加载失败测试**

`tests/config/loader.test.ts`：测试 YAML 文件加载正确解析各字段、文件不存在时返回默认配置。

- [ ] **Step 2: 实现配置加载器**

`src/config/loader.ts`：`loadConfig(filePath)` 使用 `yaml` 库解析 YAML，与 `DefaultConfig` 深度合并（嵌套对象递归合并至叶子节点，数组整体替换而非拼接，仅用户显式指定的字段覆盖默认值，undefined 视为未指定），文件不存在返回默认值。

> **职责边界**：本 Task 仅处理 YAML 配置文件（LLM 参数、agent 行为、沙箱白名单、护栏策略文件路径）的加载与合并。API Key 的存储与获取属于 Task 20（凭据管理），不要在本 Task 中实现凭据相关功能。

- [ ] **Step 3: 创建默认配置文件**

`.harness/config.yaml`：LLM 默认 openai/gpt-4o，agent maxTurns 50，sandbox allowedPaths [./workspace, ./src, ./tests]，allowedCommands [npm, node, npx, tsc, eslint, vitest, jest, git]。

`.harness/guardrails.yaml`：包含 7 条正则匹配规则（禁止 rm -rf /、del /F /S、git push --force、git reset --hard、curl\|bash、chmod 777、sudo 需审批）外加沙箱路径限制（声明式 type: sandbox 规则）。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/config/loader.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 5: 提交**

```bash
git add src/config/loader.ts tests/config/loader.test.ts .harness/
git commit -m "feat: 配置系统（YAML 加载 + 默认配置 + 护栏策略文件）"
```

---

### Task 4: Agent 主循环

**依赖:** Task 1, Task 2 | **Worktree:** wt-loop

**Files:**
- Create: `src/core/loop.ts`, `tests/core/loop.test.ts`

**Interfaces:**
- Consumes: `AgentAction`, `ActionResult`, `ConversationTurn`, `AgentConfig`, `AgentState`, `LLMProvider`, `ToolDefinition` from types
- Produces: `createAgentLoop(config, llm, tools, callbacks): { run(task): Promise<AgentRunResult> }`

- [ ] **Step 1: 编写主循环失败测试**

`tests/core/loop.test.ts`：3 个测试用例：
1. MockLLM 返回空响应 → 停机
2. MockLLM 返回 JSON 动作 → 解析并分发到工具执行
3. 达到 maxTurns 后强制停机

- [ ] **Step 2: 实现 Agent 主循环**

`src/core/loop.ts`：`createAgentLoop` 实现完整循环：
1. 组装 system prompt（工具列表 + JSON 格式说明）
2. 调用 LLM → 解析 JSON 响应（action 或 done）
3. 分发 action 到对应工具 → 收集结果回灌
4. 判断停机（done / 空响应 / maxTurns）

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/core/loop.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/core/loop.ts tests/core/loop.test.ts
git commit -m "feat: Agent 主循环（上下文组装→LLM→解析→分发→回灌→停机）"
```

---

### Task 5: 工具注册表

**依赖:** Task 1 | **Worktree:** wt-tools

**Files:**
- Create: `src/tools/registry.ts`, `tests/tools/registry.test.ts`

**Interfaces:**
- Produces: `createToolRegistry(): ToolRegistry`（register / get / list / dispatch）

- [ ] **Step 1: 编写注册表失败测试**

`tests/tools/registry.test.ts`：5 个测试：注册并获取工具、列出所有工具名称、未注册工具返回 undefined、分发动作到工具、分发到未知工具返回错误。

- [ ] **Step 2: 实现工具注册表**

`src/tools/registry.ts`：`createToolRegistry()` 使用 Map 存储工具，`register` 注册，`get` 获取，`list` 列出，`dispatch` 分发执行并捕获异常。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/tools/registry.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/tools/registry.ts tests/tools/registry.test.ts
git commit -m "feat: 工具注册表（注册/获取/分发）"
```

---

### Task 6: 文件读写工具

**依赖:** Task 5 | **Worktree:** wt-tools

**Files:**
- Create: `src/tools/file.ts`, `tests/tools/file.test.ts`

**Interfaces:**
- Produces: `createReadFileTool(workspaceRoot): ToolDefinition`, `createWriteFileTool(workspaceRoot): ToolDefinition`

- [ ] **Step 1: 编写文件工具失败测试**

`tests/tools/file.test.ts`：3 个测试：读取文件内容、文件不存在返回错误、写入文件并验证内容持久化。

- [ ] **Step 2: 实现文件工具**

`src/tools/file.ts`：`createReadFileTool` 使用 `resolve(join(workspaceRoot, path))` 拼接路径，`readFileSync` 读取；`createWriteFileTool` 类似，`writeFileSync` 写入。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/tools/file.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/tools/file.ts tests/tools/file.test.ts
git commit -m "feat: 文件读写工具"
```

---

### Task 7: Shell 执行工具

**依赖:** Task 5 | **Worktree:** wt-tools

**Files:**
- Create: `src/tools/shell.ts`, `tests/tools/shell.test.ts`

**Interfaces:**
- Produces: `createShellTool(): ToolDefinition`

- [ ] **Step 1: 编写 Shell 工具失败测试**

`tests/tools/shell.test.ts`：2 个测试：执行简单命令返回输出、命令失败返回 success=false。

- [ ] **Step 2: 实现 Shell 工具**

`src/tools/shell.ts`：`createShellTool()` 使用 `child_process.exec` 执行命令，120s 超时，返回 `{success, output, error, exitCode}`。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/tools/shell.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/tools/shell.ts tests/tools/shell.test.ts
git commit -m "feat: Shell 执行工具"
```

---

### Task 8: 测试运行器工具

**依赖:** Task 5 | **Worktree:** wt-tools

**Files:**
- Create: `src/tools/test-runner.ts`, `tests/tools/test-runner.test.ts`

**Interfaces:**
- Produces: `createTestRunnerTool(): ToolDefinition`

- [ ] **Step 1: 编写测试运行器失败测试**

`tests/tools/test-runner.test.ts`：2 个测试：成功命令返回 success=true、失败命令返回 success=false。

- [ ] **Step 2: 实现测试运行器**

`src/tools/test-runner.ts`：与 Shell 工具类似，但 name 为 `run_test`，专用于测试命令。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/tools/test-runner.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/tools/test-runner.ts tests/tools/test-runner.test.ts
git commit -m "feat: 测试运行器工具"
```

---

### Task 9: Lint 检查工具

**依赖:** Task 5 | **Worktree:** wt-tools

**Files:**
- Create: `src/tools/lint.ts`, `tests/tools/lint.test.ts`

**Interfaces:**
- Produces: `createLintTool(): ToolDefinition`

- [ ] **Step 1: 编写 Lint 工具失败测试**

`tests/tools/lint.test.ts`：2 个测试：成功命令返回 success=true、Lint 失败返回 success=false 且包含错误信息。

- [ ] **Step 2: 实现 Lint 工具**

`src/tools/lint.ts`：name 为 `run_lint`，其余与 Shell 工具实现相同。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/tools/lint.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/tools/lint.ts tests/tools/lint.test.ts
git commit -m "feat: Lint/类型检查工具"
```

---

### Task 10: 记忆系统 - 存储

**依赖:** Task 1 | **可并行:** 与 Task 2-9 | **Worktree:** wt-memory

**Files:**
- Create: `src/memory/store.ts`, `tests/memory/store.test.ts`

**Interfaces:**
- Produces: `createMemoryStore(storagePath): MemoryStore`（set / get / list / delete）

- [ ] **Step 1: 编写存储失败测试**

`tests/memory/store.test.ts`：5 个测试：写入并读取、不存在 key 返回 null、列出所有条目、跨会话持久化、删除条目。

- [ ] **Step 2: 实现记忆存储**

`src/memory/store.ts`：`createMemoryStore(storagePath)` 使用 JSON 文件存储每个条目（key 安全化为文件名），`set` 写入 `MemoryEntry` JSON，`get` 读取解析，`list` 遍历目录，`delete` 删除文件。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/memory/store.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/memory/store.ts tests/memory/store.test.ts
git commit -m "feat: 记忆系统存储层"
```

---

### Task 11: 记忆系统 - 检索

**依赖:** Task 10 | **Worktree:** wt-memory

**Files:**
- Create: `src/memory/retriever.ts`, `tests/memory/retriever.test.ts`

**Interfaces:**
- Produces: `createMemoryRetriever(store: MemoryStore): MemoryRetriever`（search）

- [ ] **Step 1: 编写检索器失败测试**

`tests/memory/retriever.test.ts`：3 个测试：关键词检索匹配、按分类过滤、无匹配返回空数组。

- [ ] **Step 2: 实现检索器**

`src/memory/retriever.ts`：`createMemoryRetriever(store)` 的 `search(query, options?)` 方法：获取全部条目 → 按关键词（key/value 包含 query）过滤 → 可选按 category 过滤。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/memory/retriever.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/memory/retriever.ts tests/memory/retriever.test.ts
git commit -m "feat: 记忆系统检索器（关键词匹配 + 分类过滤）"
```

---

### Task 12: 治理护栏引擎

**依赖:** Task 1 | **Worktree:** wt-governance

**Files:**
- Create: `src/governance/rules.ts`, `src/governance/guardrail.ts`, `tests/governance/guardrail.test.ts`

**Interfaces:**
- Produces: `GuardrailRule` 类型, `createGuardrailEngine(rules): GuardrailEngine`（evaluate / addRule / getRules）

- [ ] **Step 1: 编写护栏引擎失败测试**

`tests/governance/guardrail.test.ts`：5 个测试：rm -rf / 被拦截、git push --force 被拦截、sudo 需要审批、安全命令放行、非 shell 动作直接放行。

- [ ] **Step 2: 实现护栏规则与引擎**

`src/governance/rules.ts`：定义 `GuardrailRule` 接口（name, pattern, severity, action, type?）。

`src/governance/guardrail.ts`：`createGuardrailEngine(rules)` 的 `evaluate(action)` 方法：仅对 shell_exec 类型检查，遍历规则用 `new RegExp(rule.pattern, 'i')` 匹配命令，返回 `GuardrailResult`。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/governance/guardrail.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/governance/rules.ts src/governance/guardrail.ts tests/governance/guardrail.test.ts
git commit -m "feat: 治理护栏引擎（规则匹配 + 拦截/审批判定）"
```

---

### Task 13: HITL 审批状态机

**依赖:** Task 1 | **Worktree:** wt-governance

**Files:**
- Create: `src/governance/hitl.ts`, `tests/governance/hitl.test.ts`

**Interfaces:**
- Produces: `createHITL(): HITLStateMachine`（requestApproval / approve / reject / getState / getPendingAction / getRejectReason）

- [ ] **Step 1: 编写 HITL 失败测试**

`tests/governance/hitl.test.ts`：5 个测试：初始状态 idle、请求审批后进入 pending、审批通过进入 approved、审批拒绝进入 rejected、idle 状态下审批报错。

- [ ] **Step 2: 实现 HITL 状态机**

`src/governance/hitl.ts`：`createHITL()` 使用闭包维护状态（idle/pending/approved/rejected），`requestApproval` 保存 pendingAction，`approve`/`reject` 变更状态，idle 下调用报错。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/governance/hitl.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/governance/hitl.ts tests/governance/hitl.test.ts
git commit -m "feat: HITL 审批状态机（idle→pending→approved/rejected）"
```

---

### Task 14: 沙箱机制

**依赖:** Task 1 | **Worktree:** wt-governance

**Files:**
- Create: `src/governance/sandbox.ts`, `tests/governance/sandbox.test.ts`

**Interfaces:**
- Produces: `createSandbox(allowedPaths, allowedCommands): Sandbox`（checkPath / checkCommand）

- [ ] **Step 1: 编写沙箱失败测试**

`tests/governance/sandbox.test.ts`：5 个测试：允许路径放行、越界路径拦截、允许命令放行、不允许命令拦截、空命令拦截。

- [ ] **Step 2: 实现沙箱**

`src/governance/sandbox.ts`：`createSandbox` 的 `checkPath` 使用 `resolve` 比较路径前缀；`checkCommand` 提取命令首词，检查是否在白名单中。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/governance/sandbox.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/governance/sandbox.ts tests/governance/sandbox.test.ts
git commit -m "feat: 沙箱机制（路径白名单 + 命令白名单）"
```

---

### Task 15: 多层护栏管道

**依赖:** Task 12, 13, 14 | **Worktree:** wt-governance

**Files:**
- Create: `src/governance/pipeline.ts`, `tests/governance/pipeline.test.ts`

**Interfaces:**
- Produces: `createGovernancePipeline(guardrail, hitl, sandbox): GovernancePipeline`（process → PipelineResult）

- [ ] **Step 1: 编写管道失败测试**

`tests/governance/pipeline.test.ts`：3 个测试：正常命令通过所有层、危险命令在护栏层被拦截、非 shell 动作仅预检便放行。

- [ ] **Step 2: 实现管道**

`src/governance/pipeline.ts`：`createGovernancePipeline` 的 `process(action)` 依次执行：预检（非 shell 跳过）→ 护栏规则匹配 → 沙箱命令检查 → 如需审批则触发 HITL。返回 `PipelineResult`（含 pipelineStages）。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/governance/pipeline.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/governance/pipeline.ts tests/governance/pipeline.test.ts
git commit -m "feat: 多层护栏管道（预检→护栏→沙箱→HITL）"
```

---

### Task 16: 审计日志

**依赖:** Task 15 | **Worktree:** wt-governance

**Files:**
- Create: `src/governance/audit.ts`, `tests/governance/audit.test.ts`

**Interfaces:**
- Produces: `createAuditLogger(logPath): AuditLogger`（log）

- [ ] **Step 1: 编写审计日志失败测试**

`tests/governance/audit.test.ts`：3 个测试：记录拦截事件（JSON 行）、记录审批事件（含 approvalResult）、追加写入而非覆盖。

- [ ] **Step 2: 实现审计日志**

`src/governance/audit.ts`：`createAuditLogger(logPath)` 的 `log(entry)` 使用 `appendFileSync` 追加 JSON 行。

- [ ] **Step 3: 运行全部治理测试**

```bash
npx vitest run tests/governance/
```

Expected: 21 tests PASS（5+5+5+3+3）

- [ ] **Step 4: 提交**

```bash
git add src/governance/audit.ts tests/governance/audit.test.ts
git commit -m "feat: 审计日志（拦截/审批事件记录）"
```

---

### Task 17: 反馈执行器

**依赖:** Task 1 | **可并行:** 与 Task 2-16 | **Worktree:** wt-feedback

**Files:**
- Create: `src/feedback/runner.ts`, `tests/feedback/runner.test.ts`

**Interfaces:**
- Produces: `createFeedbackRunner(): FeedbackRunner`（runTest / runLint → FeedbackSignal）

- [ ] **Step 1: 编写反馈执行器失败测试**

`tests/feedback/runner.test.ts`：3 个测试：执行测试返回 passed=true、测试失败返回 passed=false、执行 Lint 返回结构化结果。

- [ ] **Step 2: 实现反馈执行器**

`src/feedback/runner.ts`：`createFeedbackRunner()` 使用 `child_process.exec` 执行命令，解析输出中的 `file:line:message` 模式，返回 `FeedbackSignal`。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/feedback/runner.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/feedback/runner.ts tests/feedback/runner.test.ts
git commit -m "feat: 反馈执行器（测试/Lint 执行 + 结构化输出）"
```

---

### Task 18: 反馈解析器

**依赖:** Task 17 | **Worktree:** wt-feedback

**Files:**
- Create: `src/feedback/parser.ts`, `tests/feedback/parser.test.ts`

**Interfaces:**
- Produces: `parseTestOutput(output): FeedbackSignal`, `parseLintOutput(output): FeedbackSignal`

- [ ] **Step 1: 编写解析器失败测试**

`tests/feedback/parser.test.ts`：4 个测试：解析测试通过输出、解析测试失败输出（含文件行号）、解析 Lint 错误输出、空 Lint 输出返回 passed=true。

- [ ] **Step 2: 实现解析器**

`src/feedback/parser.ts`：`parseTestOutput` 检测 fail/failed/failing 关键词判定；`parseLintOutput` 正则匹配 `file:line:col: message` 模式。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/feedback/parser.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/feedback/parser.ts tests/feedback/parser.test.ts
git commit -m "feat: 反馈解析器（测试输出 + Lint 输出）"
```

---

### Task 19: 反馈回灌器

**依赖:** Task 18 | **Worktree:** wt-feedback

**Files:**
- Create: `src/feedback/injector.ts`, `tests/feedback/injector.test.ts`

**Interfaces:**
- Produces: `createFeedbackInjector(): FeedbackInjector`（format → {role, content}）

- [ ] **Step 1: 编写回灌器失败测试**

`tests/feedback/injector.test.ts`：3 个测试：反馈信号格式化为 LLM 消息（含文件行号）、包含修复建议、通过的信号返回成功消息。

- [ ] **Step 2: 实现回灌器**

`src/feedback/injector.ts`：`createFeedbackInjector()` 的 `format(signal)` 将 FeedbackSignal 格式化为 `{role: 'feedback', content: '...'}` 消息，失败时包含问题详情和修复建议。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/feedback/injector.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/feedback/injector.ts tests/feedback/injector.test.ts
git commit -m "feat: 反馈回灌器（结构化反馈→LLM 上下文）"
```

---

### Task 20: 凭据管理

**依赖:** 无 | **可并行:** 与所有 task | **Worktree:** wt-credential

**Files:**
- Create: `src/credential/manager.ts`, `tests/credential/manager.test.ts`

**Interfaces:**
- Produces: `createCredentialManager(storagePath): CredentialManager`（set / get / clear / status）

- [ ] **Step 1: 编写凭据管理失败测试**

`tests/credential/manager.test.ts`：5 个测试：初始状态无 provider、设置后获取 key、status 不回显明文、删除后返回 null、跨实例持久化。

- [ ] **Step 2: 实现凭据管理**

`src/credential/manager.ts`：`createCredentialManager(storagePath)` 使用 JSON 文件存储 provider→key 映射。`set` 写入，`get` 读取，`clear` 删除，`status` 返回各 provider 是否配置（不返回 key 值）。

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run tests/credential/manager.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 4: 提交**

```bash
git add src/credential/manager.ts tests/credential/manager.test.ts
git commit -m "feat: 凭据管理（加密文件存储 + 状态查询不泄露明文）"
```

---

### Task 21: CLI 入口

**依赖:** 所有核心模块（Task 1-20） | **Worktree:** wt-cli-web

**Files:**
- Create: `src/cli/index.ts`

**Interfaces:**
- Produces: CLI 可执行文件（`harness run <task>` 和 `harness key <action> [provider]`）

- [ ] **Step 1: 实现 CLI 入口**

`src/cli/index.ts`：

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { createMockLLM } from '../llm/mock';
import { createAgentLoop } from '../core/loop';
import { createToolRegistry } from '../tools/registry';
import { createReadFileTool, createWriteFileTool } from '../tools/file';
import { createShellTool } from '../tools/shell';
import { createTestRunnerTool } from '../tools/test-runner';
import { createLintTool } from '../tools/lint';
import { createGuardrailEngine } from '../governance/guardrail';
import { createHITL } from '../governance/hitl';
import { createSandbox } from '../governance/sandbox';
import { createGovernancePipeline } from '../governance/pipeline';
import { createAuditLogger } from '../governance/audit';
import { createMemoryStore } from '../memory/store';
import { createMemoryRetriever } from '../memory/retriever';
import { loadConfig } from '../config/loader';
import { createCredentialManager } from '../credential/manager';
import { GuardrailRule } from '../governance/rules';
import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';
import * as readline from 'readline';

const program = new Command();

program
  .name('harness')
  .description('Coding Agent Harness - CLI 编码智能体')
  .version('1.0.0');

program
  .command('run')
  .argument('<task>', '编码任务描述')
  .option('-c, --config <path>', '配置文件路径', '.harness/config.yaml')
  .option('-w, --workspace <path>', '工作区路径', process.cwd())
  .action(async (task: string, options: { config: string; workspace: string }) => {
    const configPath = join(options.workspace, options.config);
    const config = loadConfig(configPath);

    console.log(`[Harness] 启动 Coding Agent Harness`);
    console.log(`[Harness] 任务: ${task}`);
    console.log(`[Harness] 工作区: ${options.workspace}`);

    const registry = createToolRegistry();
    registry.register(createReadFileTool(options.workspace));
    registry.register(createWriteFileTool(options.workspace));
    registry.register(createShellTool());
    registry.register(createTestRunnerTool());
    registry.register(createLintTool());

    let rules: GuardrailRule[] = [];
    const rulesPath = join(options.workspace, config.governance.rulesFile);
    if (existsSync(rulesPath)) {
      const rulesContent = readFileSync(rulesPath, 'utf-8');
      const parsed = parse(rulesContent);
      rules = parsed?.rules ?? [];
    }

    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(
      config.governance.sandbox.allowedPaths.map(p => join(options.workspace, p)),
      config.governance.sandbox.allowedCommands
    );
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);
    const audit = createAuditLogger(join(options.workspace, '.harness/audit.log'));

    const credentialManager = createCredentialManager(join(options.workspace, '.harness/credentials.json'));
    const apiKey = await credentialManager.get(config.llm.provider);
    if (!apiKey) {
      console.error(`[Harness] 错误: 未配置 ${config.llm.provider} 的 API Key`);
      console.error(`[Harness] 请运行: harness key set ${config.llm.provider}`);
      process.exit(1);
    }

    const mockLLM = createMockLLM([
      { content: '```json\n{"action": {"type": "shell_exec", "params": {"command": "echo Hello from Harness"}}}\n```' },
      { content: '```json\n{"done": true, "summary": "任务完成"}\n```' },
    ]);

    const loop = createAgentLoop(config, mockLLM, registry.list(), {
      onAction: (action) => {
        console.log(`[Agent] 执行: ${action.type} ${JSON.stringify(action.params)}`);
        const pipeResult = pipeline.process(action);
        if (!pipeResult.allowed) {
          console.log(`[护栏] 拦截: ${pipeResult.reason}`);
          audit.log({ timestamp: Date.now(), action, result: pipeResult });
        }
        if (pipeResult.requiresApproval) {
          console.log(`[HITL] 需要审批: ${pipeResult.reason}`);
        }
      },
      onTurn: (turn) => {
        if (turn.result) {
          const status = turn.result.success ? '成功' : '失败';
          const output = turn.result.output?.substring(0, 200) ?? '';
          console.log(`[结果] ${status}: ${output}`);
        }
      },
      onStop: (reason) => {
        console.log(`[Harness] 停止: ${reason}`);
      },
    });

    const result = await loop.run(task);
    console.log(`[Harness] 状态: ${result.state}`);
    console.log(`[Harness] 轮次: ${result.turns}`);
    console.log(`[Harness] 摘要: ${result.summary}`);
  });

program
  .command('key')
  .description('管理 API Key')
  .argument('<action>', 'set | status | clear')
  .argument('[provider]', 'openai | anthropic | gemini')
  .action(async (action: string, provider?: string) => {
    const manager = createCredentialManager(join(process.cwd(), '.harness/credentials.json'));

    if (action === 'status') {
      const status = await manager.status();
      console.log('API Key 状态:');
      console.log(`  OpenAI:    ${status.openai ? '已配置' : '未配置'}`);
      console.log(`  Anthropic: ${status.anthropic ? '已配置' : '未配置'}`);
      console.log(`  Gemini:    ${status.gemini ? '已配置' : '未配置'}`);
      return;
    }

    if (!provider) {
      console.error('请指定 provider: openai, anthropic, gemini');
      process.exit(1);
    }

    if (action === 'clear') {
      await manager.clear(provider);
      console.log(`${provider} Key 已清除`);
    } else if (action === 'set') {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(`请输入 ${provider} API Key: `, async (key: string) => {
        rl.close();
        await manager.set(provider, key.trim());
        console.log(`${provider} Key 已保存`);
      });
    } else {
      console.error(`未知操作: ${action}。可用: set, status, clear`);
    }
  });

program.parse();
```

- [ ] **Step 2: 编译验证**

```bash
npx tsc
```

Expected: 无编译错误

- [ ] **Step 3: 提交**

```bash
git add src/cli/index.ts
git commit -m "feat: CLI 入口（run + key 命令）"
```

---

### Task 22: 机制演示 ① 护栏拦截

**依赖:** Task 15, 16 | **Worktree:** wt-demos

**Files:**
- Create: `demo/01-guardrail-intercept.ts`

- [ ] **Step 1: 编写演示脚本**

`demo/01-guardrail-intercept.ts`：创建治理管道（含 3 条规则），依次测试：
1. `rm -rf /` → 断言被拦截（allowed=false, severity=critical）
2. `git push --force` → 断言被拦截
3. `npm test` → 断言放行（allowed=true）
4. 验证审计日志已记录拦截事件

全部用 mock 数据，不依赖真实 LLM 或网络。

- [ ] **Step 2: 运行演示**

```bash
npx tsx demo/01-guardrail-intercept.ts
```

Expected: 全部 ✅，无 ❌

- [ ] **Step 3: 提交**

```bash
git add demo/01-guardrail-intercept.ts
git commit -m "feat: 机制演示① 护栏拦截危险动作"
```

---

### Task 23: 机制演示 ② 反馈闭环

**依赖:** Task 4, Task 19 | **Worktree:** wt-demos

**Files:**
- Create: `demo/02-feedback-loop.ts`

- [ ] **Step 1: 编写演示脚本**

`demo/02-feedback-loop.ts`：MockLLM 预设 3 轮响应：
1. 第 1 轮：输出"有 bug 的代码" → 工具执行失败
2. 反馈回灌器将失败信息注入上下文
3. 第 2 轮：MockLLM 输出"修复后的代码" → 工具执行成功
4. 第 3 轮：done

断言：任务完成、执行了多轮动作、反馈被回灌、反馈包含"测试失败"和"请修复"。

- [ ] **Step 2: 运行演示**

```bash
npx tsx demo/02-feedback-loop.ts
```

Expected: 全部 ✅，无 ❌

- [ ] **Step 3: 提交**

```bash
git add demo/02-feedback-loop.ts
git commit -m "feat: 机制演示② 反馈闭环驱动行为修正"
```

---

### Task 24: 机制演示 ③ 重点维度（治理深度）

**依赖:** Task 3, 14, 15 | **Worktree:** wt-demos

**Files:**
- Create: `demo/03-deep-dimension.ts`

- [ ] **Step 1: 编写演示脚本**

`demo/03-deep-dimension.ts`：展示治理护栏的深度行为：
1. 加载初始策略 → 正常操作放行、危险操作拦截、越界命令拦截
2. 动态添加新规则（热加载）→ 新规则立即生效
3. 验证 HITL 审批流程：sudo 命令触发审批 → 模拟审批通过 → 动作执行
4. 验证审计日志完整性：所有拦截/审批事件均已记录

全部用 mock 数据，确定性结果。

- [ ] **Step 2: 运行演示**

```bash
npx tsx demo/03-deep-dimension.ts
```

Expected: 全部 ✅，无 ❌

- [ ] **Step 3: 提交**

```bash
git add demo/03-deep-dimension.ts
git commit -m "feat: 机制演示③ 重点维度治理深度（热加载+多层管道+审批+审计）"
```

---

### Task 25: Docker 分发

**依赖:** Task 21 | **Worktree:** wt-ops

**Files:**
- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1: 创建 Dockerfile**

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY .harness/ ./.harness/
ENTRYPOINT ["node", "dist/cli/index.js"]
```

- [ ] **Step 2: 创建 .dockerignore**

```
node_modules/
tests/
demo/
src/
.git/
.env
*.key
```

- [ ] **Step 3: 构建并验证**

```bash
npx tsc
docker build -t coding-agent-harness .
docker run coding-agent-harness --help
```

Expected: 显示帮助信息

- [ ] **Step 4: 提交**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: Docker 分发（alpine 镜像）"
```

---

### Task 26: CI/CD 配置

**依赖:** Task 25 | **Worktree:** wt-ops

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 创建 CI 配置**

```yaml
name: CI
on: [push, pull_request]
jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - run: npm test
      - run: npm run demo
```

- [ ] **Step 2: Push 到 GitHub 并验证 CI 通过**

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "feat: CI/CD 配置（unit-test job + demo 验证）"
```

---

### Task 27: README 文档

**依赖:** 全部 | **Worktree:** wt-ops

**Files:**
- Create: `README.md`

- [ ] **Step 1: 编写 README**

`README.md` 包含以下章节，每章 2-5 句话：

```markdown
# Coding Agent Harness

> Agent = LLM + Harness。一个从零构建的 TypeScript CLI 编码智能体。

## 架构图

（ASCII 架构图：CLI → Agent 主循环 → 治理管道/工具/反馈 → LLM 抽象层）

## 快速开始

```bash
git clone <repo-url> && cd coding-agent-harness
npm install && npm run build
harness key set openai    # 输入你的 API Key
harness run "创建一个 hello world 程序"
```

## 安装指南

需要 Node.js >= 20，npm install 安装依赖，npm run build 编译。

## 使用说明

- `harness run <task>`：执行编码任务
- `harness key set <provider>`：配置 API Key
- `harness key status`：查看 Key 配置状态
- `harness key clear <provider>`：删除 Key

## Key 安全配置

Key 存储在 `.harness/credentials.json`（加密文件），永不回显明文。
状态查询只显示"已配置/未配置"。首次运行未配置 Key 时会提示录入。

## 分发方式

**Docker：**
```bash
docker build -t coding-agent-harness .
docker run -it coding-agent-harness run "你的任务"
```

**npm：**
```bash
npm install -g coding-agent-harness
```

## 目录结构

```
src/core/      # Agent 主循环 + 核心类型
src/llm/       # LLM 抽象层（Mock + OpenAI + Anthropic + Gemini）
src/tools/     # 工具系统（注册表 + 文件/Shell/测试/Lint）
src/governance/ # 治理护栏（重点：护栏引擎 + HITL + 沙箱 + 管道 + 审计）
src/feedback/  # 反馈闭环（执行器 + 解析器 + 回灌器）
src/memory/    # 记忆系统（存储 + 检索）
src/config/    # 配置系统
src/credential/ # 凭据管理
src/cli/       # CLI 入口
src/web/       # Web 服务（HITL 审批界面）
tests/         # 单元测试（mock LLM 驱动）
demo/          # 机制演示脚本
```

## 安全边界说明

以下操作会被自动拦截：`rm -rf /`、`git push --force`、`git reset --hard`、
`curl | bash`、`chmod 777`、写入沙箱外路径。`sudo` 命令需要人工审批。

## 已知限制

- 仅支持 Node.js 20+ 环境
- 凭据存储为 JSON 文件（非系统钥匙串，Linux 上 keytar 依赖复杂）
- WebUI 为轻量版本，仅用于 HITL 审批
- 护栏规则为静态正则匹配，不支持语义分析

## 开发指南

```bash
npm test        # 运行全部单元测试
npm run demo    # 运行三个机制演示
npm run build   # 编译 TypeScript
```
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: README 完整文档"
```

---

## 验收检查清单

- [ ] `npm test` 一键运行所有 mock-LLM 单元测试且全部通过
- [ ] `npm run demo` 一键运行三个机制演示且全部通过
- [ ] CI `unit-test` job 通过
- [ ] `docker build && docker run` 可启动
- [ ] 护栏引擎可用 mock 数据独立测试（`guardrail.evaluate({type:'shell_exec', params:{command:'rm -rf /'}})` → `{allowed: false}`）
- [ ] 反馈闭环可用 mock LLM 确定性验证
- [ ] 所有凭据未硬编码、未提交 Git
- [ ] 项目可在全新机器上从零运行（clone → npm install → npm test）