# Coding Agent Harness · SPEC.md

> Agent = LLM + Harness。一个面向软件开发场景的 CLI 编码智能体，用 TypeScript 从零构建。

---

## 一、问题陈述

### 1.1 要解决的问题

现代软件开发中，LLM 已能完成大部分"思考"——决定下一步做什么。但让 LLM 稳定、可靠地完成编码任务，需要一层工程化封装：组织上下文、分发工具、拦截危险操作、提供客观反馈、跨会话记忆。这些工程机制构成了 **Harness**——将 LLM 从"会思考的模型"变成"能工作的系统"。

### 1.2 目标用户

- 希望通过 CLI 与 AI 协作编码的开发者
- 需要安全护栏防止 AI 误操作破坏项目的团队
- 想研究 Agent 工程机制的学习者

### 1.3 为什么值得做

现有编码智能体（Claude Code、Codex、Cursor）是封闭的 harness。本项目从零构建一个开放的、可审计的、机制可独立验证的 harness，帮助理解"当 LLM 能编码时，工程师的真正价值在哪里"。

---

## 二、用户故事

1. **作为开发者**，我可以在终端中输入编码任务，让 agent 自动编写代码、运行测试、根据测试结果自我修正，从而完成一个完整的 TDD 循环。
2. **作为开发者**，当 agent 尝试执行 `rm -rf /` 或 `git push --force` 等危险操作时，系统应自动拦截并等待我确认，防止误操作破坏项目。
3. **作为开发者**，我可以切换不同的 LLM 供应商（OpenAI/Anthropic/Gemini），只需修改配置而无需改代码。
4. **作为开发者**，我可以安全地存储 API Key 到系统钥匙串，agent 首次运行时会引导我录入，且任何时候都不会在日志或终端中回显明文 Key。
5. **作为开发者**，agent 应记住跨会话的项目约定和重要决策，下次启动时自动加载，避免我重复说明。
6. **作为运维者**，我可以通过 `docker pull && docker run` 一键启动 agent，并在 README 中找到完整的 key 配置说明。
7. **作为学习者**，我可以运行 `make test` 一键执行所有 mock-LLM 确定性单元测试，验证 harness 的每个核心机制——无需真实 LLM 或网络。

---

## 三、功能规约

### 3.1 Agent 主循环

**输入**：用户任务描述（自然语言）  
**行为**：
1. 组装上下文（用户任务 + 对话历史 + 记忆 + 配置规则）
2. 调用 LLM 获取下一步动作
3. 解析 LLM 输出为结构化动作（工具 + 参数）
4. 通过治理管道检查动作安全性
5. 分发动作到对应工具执行
6. 收集执行结果 + 反馈信号
7. 将结果回灌到上下文
8. 判断是否停机（任务完成 / 最大轮次 / 用户中断）

**输出**：任务完成状态 + 执行摘要  
**边界条件**：最大轮次 50 轮，超时 5 分钟，可配置  
**错误处理**：LLM 调用失败重试 3 次；工具执行异常捕获并回灌给 LLM

### 3.2 LLM 抽象层

**输入**：消息数组 + 供应商配置  
**行为**：路由到对应供应商 adapter，发送请求，返回响应  
**边界条件**：超时 60s，Rate Limit 自动退避  
**错误处理**：网络错误重试 3 次，401/403 提示检查 Key

### 3.3 工具系统

#### 3.3.1 文件读写
- `read_file(path)`: 读取文件内容，路径受沙箱约束
- `write_file(path, content)`: 写入文件，路径受沙箱约束

#### 3.3.2 Shell 执行
- `shell_exec(command)`: 执行命令，受护栏拦截
- 返回 `{stdout, stderr, exitCode}`

#### 3.3.3 测试运行
- `run_test(command)`: 执行测试，解析结果为结构化数据
- 返回 `{passed, failures[], summary}`

#### 3.3.4 Lint 检查
- `run_lint(files)`: 执行 ESLint / TypeScript 编译检查
- 返回 `{errors[{file, line, message}]}`

### 3.4 治理护栏（重点维度）

#### 3.4.1 多层护栏管道
1. **预检层**：空动作直接放行
2. **规则匹配层**：正则/模板匹配危险模式 → 命中则拦截
3. **沙箱校验层**：路径白名单 + 命令白名单 → 越界拦截
4. **审批层**：HITL 状态机（展示动作 → 等待输入 → 放行/拒绝）
5. **审计日志层**：记录所有拦截/审批事件

#### 3.4.2 危险动作分类
| 类别 | 示例 | 策略 |
|------|------|------|
| 文件破坏 | `rm -rf /`, `del /F /S` | 拦截 |
| 系统修改 | `chmod 777`, `sudo` | 拦截 |
| 网络外发管道 | `curl ... \| bash` | 拦截 |
| 版本控制危险 | `git push --force`, `git reset --hard` | 拦截 |
| 路径越界 | 写入沙箱外路径 | 拦截 |

#### 3.4.3 HITL 状态机
```
IDLE → PENDING（展示动作详情）→ APPROVED（执行）/ REJECTED（拒绝+原因回灌）
```

#### 3.4.4 声明式策略配置
通过 `.harness/guardrails.yaml` 定义规则，支持热加载：
```yaml
rules:
  - name: "禁止递归删除根目录"
    pattern: "rm\\s+-rf\\s+/"
    severity: critical
    action: block
  - name: "沙箱路径限制"
    type: sandbox
    allowed_paths: ["./workspace", "./src", "./tests"]
    action: block
```

### 3.5 反馈闭环

**输入**：工具执行结果  
**行为**：
1. 测试运行器：执行测试 → 解析 JUnit/JSON 输出 → 结构化判定
2. Lint/类型检查：执行 → 解析输出 → 结构化诊断
3. 反馈回灌器：将结构化反馈注入下一轮 LLM 上下文

**输出**：`{type, passed, details[], summary}`  
**边界条件**：测试超时 120s，解析失败降级为原始输出

### 3.6 记忆系统

**会话内**：内存数组存储最近 20 轮对话  
**跨会话**：JSON 文件存储于 `.harness/memory/`，支持关键词检索  
**项目约定**：自动提取用户标注的约定，下次会话自动加载

### 3.7 配置系统

**输入**：YAML 配置文件（`.harness/config.yaml`）  
**行为**：加载 → 解析 → 映射为确定性行为约束  
**可配置项**：LLM 供应商、模型、最大轮次、超时、护栏策略路径

### 3.8 凭据管理

**安全存储**：优先使用操作系统钥匙串（Windows Credential Manager / macOS Keychain），`.env` 文件仅作后备  
**命令**：
- `harness key set <provider>`：隐藏输入 → 存入钥匙串
- `harness key status`：显示各供应商 Key 状态（不显示明文）
- `harness key clear <provider>`：确认后删除

---

## 四、非功能性需求

### 4.1 性能
- Agent 主循环单轮延迟 < 5s（不含 LLM 调用）
- 工具分发延迟 < 100ms
- 护栏管道处理延迟 < 50ms

### 4.2 安全

#### 凭据威胁模型
| 威胁 | 对策 |
|------|------|
| Git 提交泄露 | `.gitignore` + pre-commit hook 扫描 |
| 日志/终端泄露 | 自动脱敏，Key 查看只显示前后 4 位 |
| 进程环境可见 | 优先钥匙串，`.env` 标注风险 |
| 首次录入 | 隐藏输入 + 二次确认 |

#### 运行安全
- 护栏管道在每次工具执行前运行
- 沙箱限制文件系统和命令范围
- 审计日志记录所有危险操作和审批

### 4.3 可用性
- 首次运行引导式配置
- 清晰的错误提示（Key 未配置、网络错误、权限不足）
- `--help` 显示完整命令列表

### 4.4 可观测性
- 护栏拦截/审批事件记录到审计日志
- Agent 每轮动作记录到会话日志
- 支持 `--verbose` 显示详细调试信息

---

## 五、系统架构

### 5.1 组件图

```
┌─────────────────────────────────────────┐
│              CLI 入口层                  │
│         (harness "你的任务")             │
├─────────────────────────────────────────┤
│             Agent 主循环                 │
│  context → LLM → parse → dispatch →     │
│  re-ingest → stop check                 │
├──────────┬──────────┬───────────────────┤
│ 治理管道  │ 反馈闭环  │   工具注册表       │
│ (重点)    │          │                   │
│ ·护栏    │ ·测试运行 │  ·文件读写         │
│ ·HITL    │ ·Lint    │  ·Shell 执行       │
│ ·沙箱    │ ·回灌    │  ·测试运行         │
│ ·审计    │          │  ·Lint             │
├──────────┴──────────┴───────────────────┤
│        LLM 抽象层 (多供应商 adapter)      │
│     OpenAI │ Anthropic │ Gemini │ Mock   │
├─────────────────────────────────────────┤
│  记忆系统  │  配置系统  │  凭据管理       │
└─────────────────────────────────────────┘
```

### 5.2 数据流

```
用户输入 → 主循环
  → 组装上下文 (记忆 + 配置 + 历史)
  → 调用 LLM (通过抽象层)
  → 解析动作
  → 治理管道检查 (护栏 → 沙箱 → HITL)
  → 工具分发执行
  → 收集结果 + 反馈信号
  → 回灌上下文
  → 判断停机 / 继续下一轮
```

### 5.3 外部依赖
- OpenAI API / Anthropic API / Google Gemini API
- ESLint / TypeScript Compiler（用于 Lint/类型检查）
- 系统钥匙串（Windows Credential Manager / macOS Keychain）

---

## 六、数据模型

### 6.1 核心实体

```typescript
interface AgentAction {
  type: 'read_file' | 'write_file' | 'shell_exec' | 'run_test' | 'run_lint';
  params: Record<string, string>;
}

interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval?: boolean;
}

interface FeedbackSignal {
  type: 'test' | 'lint' | 'typecheck' | 'guardrail';
  passed: boolean;
  details: Array<{ file: string; line: number; message: string }>;
  summary: string;
}

interface ConversationTurn {
  role: 'user' | 'assistant' | 'system' | 'feedback';
  content: string;
  timestamp: number;
  action?: AgentAction;
  result?: ActionResult;
}

interface MemoryEntry {
  key: string;
  value: string;
  category: 'convention' | 'decision' | 'structure';
  timestamp: number;
}
```

### 6.2 配置结构

```yaml
# .harness/config.yaml
llm:
  provider: openai        # openai | anthropic | gemini
  model: gpt-4o
  maxTokens: 4096
  temperature: 0.1

agent:
  maxTurns: 50
  timeout: 300000         # 5 分钟

governance:
  rulesFile: .harness/guardrails.yaml
  sandbox:
    allowedPaths: ["./workspace", "./src", "./tests"]
    allowedCommands: ["npm", "node", "tsc", "eslint", "jest", "vitest", "git"]

memory:
  storagePath: .harness/memory/
  maxConversationTurns: 20
```

---

## 七、凭据与分发设计

### 7.1 Key 存储方案

**主方案**：操作系统钥匙串
- Windows: Credential Manager（通过 `keytar` 或 `wincred` 库）
- macOS: Keychain（通过 `keytar` 库）
- Linux: Secret Service / 加密文件后备

**后备方案**：AES-256 加密文件（主密码保护）

**命令接口**：
```bash
harness key set openai     # 隐藏输入 → 存入钥匙串
harness key status          # 显示各供应商状态（不显示明文）
harness key clear openai    # 确认后删除
```

### 7.2 分发形态

**Docker 镜像**：
```bash
docker build -t coding-agent-harness .
docker run -it coding-agent-harness "实现一个快速排序函数"
```

**npm 包**：
```bash
npm install -g coding-agent-harness
harness "实现一个快速排序函数"
```

### 7.3 目标平台
- Windows 10+ / macOS 12+ / Linux（Ubuntu 20.04+）
- Node.js 20+

---

## 八、技术选型与理由

| 技术 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript | 类型安全、前后端统一、npm 生态丰富、适合快速迭代 |
| 运行时 | Node.js 20+ | LTS 稳定、跨平台、生态完善 |
| LLM SDK | 各供应商原生 SDK | 多供应商支持，避免框架锁定 |
| 配置格式 | YAML | 可读性好、支持注释、生态成熟 |
| 测试框架 | Vitest | 快速、与 TypeScript 原生集成、兼容 Jest |
| CLI 框架 | Commander.js | 轻量、成熟、TypeScript 友好 |
| 凭据存储 | keytar | 跨平台钥匙串访问 |
| 分发 | Docker + npm | Docker 环境一致、npm 分发便捷 |
| CI/CD | GitHub Actions | 免费、与 GitHub 仓库集成 |

---

## 九、领域与机制设计

### 9.1 领域反馈信号

| 信号 | 来源 | 判定方式 | 回灌方式 |
|------|------|---------|---------|
| 测试通过/失败 | `run_test` 工具 | 解析 exit code + 测试输出 | 结构化 JSON |
| Lint 错误 | `run_lint` 工具 | 解析 ESLint/tsc 输出 | 结构化诊断列表 |
| 护栏拦截 | 治理管道 | 规则匹配 → 确定性判定 | `{blocked, reason, suggestion}` |

### 9.2 危险动作

见 §3.4.2 危险动作分类表。

### 9.3 所需工具

见 §3.3 工具系统。

### 9.4 记忆需求

见 §3.6 记忆系统。

### 9.5 重点维度：治理护栏

选择「治理」作为重点维度，理由：
1. 天然由代码构成——护栏引擎、HITL 状态机、沙箱都是确定性代码机制
2. 最契合 §4.2(C) 的 mock 单测要求——每个组件都能独立测试
3. 多层管道设计体现工程深度
4. 声明式策略配置 + 热加载是加分项

### 9.6 机制编码实现方式

所有机制（工具分发、护栏拦截、反馈回灌、记忆读写、停机判断）均通过 TypeScript 代码实现，替换为 mock LLM 后仍能用确定性单元测试验证。具体保证：
- 护栏引擎：`guardrail.evaluate(action)` 函数，输入构造的危险动作，断言返回 `{blocked: true}`
- 反馈回灌：`injector.inject(result)` 函数，输入构造的测试失败结果，验证 LLM 上下文包含结构化反馈
- 工具分发：`registry.dispatch(action)` 函数，注册 mock 工具，验证调用链
- 记忆：`store.set(key, value)` + `store.get(key)`，验证跨会话持久化

---

## 十、验收标准

| 功能 | 验收标准 |
|------|---------|
| Agent 主循环 | 用 mock LLM 驱动完整 cycle，断言各阶段输出正确 |
| LLM 抽象层 | 三个供应商 adapter 均可独立测试，mock LLM 可注入 |
| 工具系统 | 注册工具 → 分发执行 → 验证副作用，全部可 mock |
| 治理护栏 | 危险动作拦截、正常动作放行、HITL 审批流程完整 |
| 反馈闭环 | 测试失败 → 解析 → 回灌 → LLM 收到反馈 |
| 记忆系统 | 写入 → 重启 → 检索验证 |
| 凭据管理 | 录入/查看/清除流程完整，明文不泄露 |
| 机制演示 | 三个演示脚本全部用 mock LLM 驱动，确定性通过 |
| CI | `make test` 一键运行所有测试，CI 绿勾 |
| 分发 | Docker build 成功，`docker run` 可启动 |

---

## 十一、风险与未决问题

1. **跨平台钥匙串兼容性**：keytar 在 Linux 上需要 libsecret 依赖，可能需要加密文件后备方案
2. **LLM 输出解析鲁棒性**：不同供应商的响应格式差异可能影响动作解析，需要充分的格式容错
3. **护栏规则覆盖面**：初期规则集可能不够全面，需要设计为可扩展的规则框架
4. **冷启动验证**：用另一个 agent 验证 SPEC 时可能暴露未明确定义的假设