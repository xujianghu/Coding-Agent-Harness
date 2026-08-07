# AGENT_LOG.md

> Coding Agent Harness 开发过程日志。按时间顺序记录关键节点。

---

## 2026-08-07 · Phase 0-1 · 项目启动 + Brainstorming

### 环境搭建

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 |
| 触发技能 | 无（手动操作） |
| 操作 | 工作区初始化：仓库 `git init`，仅含 4 份需求文档 |
| 状态 | Git 仓库就绪，Superpowers 技能已加载 |

### Brainstorming 生成 SPEC.md

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 |
| 触发技能 | `superpowers:brainstorming` |
| 关键 Prompt | "我要构建一个 Coding Agent Harness" + 逐轮追问设计决策 |
| 产出的关键决策 | 见下表 |

**关键决策记录：**

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 运行形态 | CLI 编码助手 | 终端交互，聚焦编码场景 |
| 编程语言 | TypeScript | 类型安全、前后端统一、npm 分发 |
| LLM 供应商 | 多供应商（OpenAI/Anthropic/Gemini） | 灵活性，体现抽象层设计 |
| 重点维度 | 治理护栏 | 天然由代码构成，最契合 mock 单测要求 |
| 工具集 | 完整编码工具集（文件/Shell/测试/Lint） | 覆盖完整编码闭环 |
| 记忆系统 | 轻量增强（会话内+跨会话摘要+关键词检索） | 非重点维度，满足最低+即可 |
| 架构方案 | 分层插件式（方案 B） | 每层独立接口、可 mock、治理管道独立 |

**AI 追问的关键问题：**
1. 运行形态（CLI / Web / 混合）→ 决定架构方向
2. 编程语言选型 → 影响后续所有技术选型
3. LLM 供应商 → 决定抽象层复杂度
4. 重点维度 → 决定资源分配
5. 工具集范围 → 决定工具系统边界
6. 记忆系统深度 → 澄清了"非重点维度无需从零实现"的规则

**人工干预：**
- 在记忆系统问题上，用户主动质疑了"非重点维度是否也必须自己实现"的规则，确认了 §4.2(D) 的约束仅针对重点维度
- 用户在架构设计环节逐段审查并确认，无推翻 AI 建议的情况

**产出文件：**
- `SPEC.md`（11 章节完整）

**教训：**
- 项目要求中不同维度的约束力度不同（重点维度 vs 非重点维度），需要仔细阅读原文
- 纯 CLI 架构缺少 WebUI，需在 SPEC_PROCESS 和此处记录偏离决策

---

## 2026-08-07 · Phase 2 · Writing Plans → PLAN.md

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 |
| 触发技能 | `superpowers:writing-plans` |
| 关键 Prompt | "基于 SPEC.md，帮我生成实现计划。每个 task 2-5 分钟、明确文件路径、验证步骤、依赖关系、可并行 worktree 分组" |
| 产出 | `PLAN.md`（28 个 task） |

**Task 统计：**

| 阶段 | Task 数 | 说明 |
|------|---------|------|
| 脚手架 | 1 | 项目初始化 + 核心类型 |
| LLM 抽象层 | 1 | Mock + 3 供应商 adapter |
| 配置系统 | 1 | YAML 加载 + 默认配置 |
| Agent 主循环 | 1 | 上下文→LLM→解析→分发→回灌→停机 |
| 工具系统 | 5 | 注册表 + 文件 + Shell + 测试 + Lint |
| 记忆系统 | 2 | 存储 + 检索 |
| 治理护栏 | 5 | 规则 + 引擎 + HITL + 沙箱 + 管道 + 审计 |
| 反馈闭环 | 3 | 执行器 + 解析器 + 回灌器 |
| 凭据管理 | 1 | 加密存储 + 状态查询 |
| CLI | 1 | CLI 入口 |
| 机制演示 | 3 | 护栏拦截 + 反馈闭环 + 治理深度 |
| 分发 + CI + 文档 | 3 | Docker + GitHub Actions + README |

**可并行 worktree 分组：** 12 个 worktree（wt-scaffold, wt-llm, wt-config, wt-loop, wt-tools, wt-memory, wt-governance, wt-feedback, wt-credential, wt-cli, wt-demos, wt-ops）

**人工干预：**
- 项目定位重新确认为纯 CLI 项目，舍去 WebUI 相关部分（HITL WebUI、src/web/ 目录、WebUI 部署）。理由：本项目核心目标是构建 harness 的工程机制（主循环、治理、反馈闭环），这些机制都可以通过 CLI 交互完整呈现。HITL 审批在终端中通过 readline 实现，无需 Web 界面。此偏离需在 SPEC_PROCESS.md 中记录。
- PLAN 按 SPEC 自动生成，结构完整。

**教训：**
- writing-plans 技能要求"无占位符、每个 step 有实际代码"，这对于 28 个 task 的完整计划来说内容量极大（约 5 万字符）。实际执行时需权衡完整性 vs 可维护性
- 文件写入时遇到超长内容导致 JSON 解析失败，需注意工具的内容长度限制

---

## 2026-08-07 · Phase 3 · 冷启动验证

### 第二个智能体执行 Task 1 + Task 3

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 |
| 智能体类型 | Claude Fable 5，与主 agent 模型不同 |
| 触发技能 | `superpowers:test-driven-development`（TDD 强制执行） |
| 输入材料 | 仅 `SPEC.md` + `PLAN.md`，无任何前置对话历史或 memory |
| 选择的 Task | Task 1（项目脚手架与核心类型定义）+ Task 3（配置系统） |

**执行过程：**

1. **Task 1 脚手架**：创建 15 个目录 → 写入 `package.json`/`tsconfig.json`/`vitest.config.ts`/`.gitignore` → 写入 `src/core/types.ts`（11 个接口/类型）→ `npm install` → `tsc --noEmit` 零错误通过。由于是纯配置文件和类型定义，无可执行逻辑，不涉及 TDD。

2. **Task 3 配置系统（TDD 严格遵循）**：
   - RED：先写 `tests/config/loader.test.ts`（2 个测试），运行确认因模块不存在而失败
   - GREEN：实现 `src/config/loader.ts`（`loadConfig` + `DefaultConfig` + `deepMerge`），运行 2 tests PASS
   - 遇到 TypeScript 编译错误：`deepMerge<T extends Record<string, unknown>>` 泛型约束不兼容 `AgentConfig`（无索引签名），改为简单类型实现后通过
   - 创建 `.harness/config.yaml` + `.harness/guardrails.yaml`（7 条护栏规则）

**冷启动发现的问题：**
1. `deepMerge` 泛型类型不兼容——实现细节问题，非 SPEC 缺陷
2. 凭据管理与配置系统的职责边界需从两处文档推断——建议在 PLAN 每个 task 加边界说明
3. "深度合并"语义未精确定义（数组替换 vs 拼接？）
4. 护栏规则列举数量与内容需一致性校对（PLAN 说 7 条含沙箱规则，实际沙箱规则在 SPEC 中有 `type: sandbox` 特殊字段）

**产出文件：**
- `coding-agent-harness/` 子文件夹（含全部生成文件）
- `SPEC_PROCESS.md` §5（冷启动验证记录）

**人工干预：**
- 用户要求将生成文件移入 `coding-agent-harness/` 子文件夹
- 用户要求暂时不提交 git commit

**教训：**
- SPEC 和 PLAN 整体质量高（4/5），agent 能在无额外上下文下完成任务
- "深度合并"这类模糊术语是冷启动 agent 的典型障碍——如果主 agent 和冷启动 agent 选择了不同策略，后续集成会出 bug
- 跨 task 职责边界（配置 vs 凭据）在单 task 描述中加一句边界提示，成本极低但收益显著
- TDD 红-绿循环在冷启动 agent 上同样有效：先写测试明确了预期行为，减少了"猜实现"的风险

---

## 2026-08-07 · Phase 4 · 实现·Harness 核心骨架

### Task 4.1 · 项目脚手架（Task 1）

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 20:54 |
| 触发技能 | 无（手动执行） |
| Commit | `4364fb5` |
| 操作 | 创建 15 个目录 → 写入 `package.json`/`tsconfig.json`/`vitest.config.ts`/`.gitignore`/`src/core/types.ts` → `npm install` → `tsc --noEmit` 通过 |
| 人工干预 | 无 |

### Task 4.2 · LLM 抽象层 + 配置系统（Task 2 + 3 并行）

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:00 |
| 触发技能 | `dispatching-parallel-agents`（并行派发两个 subagent） |
| 策略 | 两个独立 task 并行执行：Task 2（LLM 抽象层）和 Task 3（配置系统） |
| Commit | `5b39587`（LLM）、`4e96473`（配置） |
| 测试 | Mock LLM 4 tests + OpenAI 4 tests + Anthropic 5 tests + Gemini 6 tests + Config 8 tests = 27 tests PASS |
| 人工干预 | 无。两个 subagent 均按 TDD 流程独立完成 |

### Task 4.3-4.5 · 主循环 + 工具注册表 + 记忆存储 + 护栏引擎（4 并行）

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:05 |
| 触发技能 | `dispatching-parallel-agents`（并行派发 4 个 subagent） |
| 并行任务 | Task 4（主循环）、Task 5（工具注册表）、Task 10（记忆存储）、Task 12（护栏引擎） |
| Commit | `818e28e`（主循环）、`be9121c`（注册表）、`19a52ed`（记忆）、`6b27b58`（护栏） |
| 测试 | 7+5+5+5 = 22 tests，全量 49 tests PASS |
| 人工干预 | 无 |

### Task 4.6 · 工具实现 + 记忆检索 + HITL + 沙箱（7 并行）

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:10 |
| 触发技能 | `dispatching-parallel-agents`（并行派发 7 个 subagent） |
| 并行任务 | Task 6（文件）、Task 7（Shell）、Task 8+9（测试运行器+Lint）、Task 11（记忆检索）、Task 13（HITL）、Task 14（沙箱） |
| Commit | `b1db214`、`5debe0d`、`53dcb18`、`794250b`、`ddf540d`、`445b687` |
| 测试 | 全量 73 tests PASS |
| 人工干预 | 无 |

**教训：**
- 7 个 subagent 并行派发是最激进的一次，但全部成功——前提是每个 task 的依赖关系已正确标注
- `dispatching-parallel-agents` 技能在依赖图清晰的场景下效率极高：7 个 task 在 1 轮并行中完成，而非 7 轮串行

---

## 2026-08-07 · Phase 5-7 · 治理护栏 + 反馈闭环 + 深入

### Task 5.1-5.3 · 护栏管道 + 反馈执行器 + 凭据管理（3 并行）

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:16 |
| 触发技能 | `dispatching-parallel-agents` |
| 并行任务 | Task 15（护栏管道）、Task 17（反馈执行器）、Task 20（凭据管理） |
| Commit | `e1aa238`、`cf06bb7`、`877f65e` |
| 测试 | 全量 84 tests PASS |
| 人工干预 | 无 |

### Task 5.4-5.5 · 审计日志 + 反馈解析器（2 并行）

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:20 |
| 触发技能 | `dispatching-parallel-agents` |
| 并行任务 | Task 16（审计日志）、Task 18（反馈解析器） |
| Commit | `fc730e7`、`02267b2` |
| 人工干预 | 无 |

### Task 5.6-5.8 · 反馈回灌器 + CLI + 演示（3 并行）

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:23 |
| 触发技能 | `dispatching-parallel-agents` |
| 并行任务 | Task 19（反馈回灌器）、Task 21（CLI 入口）、Task 22-24（机制演示） |
| Commit | `18549af`、`78c5a22`、`b9551f9` |
| 人工干预 | 反馈回灌器测试格式不匹配（`All checks passed` vs `[LINT] PASSED`），手动修复测试断言 |
| 教训 | 当多个 subagent 分别实现相互依赖的模块时，接口格式可能不一致，需要在集成阶段人工对齐 |

---

## 2026-08-07 · Phase 8-10 · 分发 + CI + 文档

### Task 8.1-8.3 · Docker + CI + README（3 并行）

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:30 |
| 触发技能 | `dispatching-parallel-agents` |
| 并行任务 | Task 25（Dockerfile）、Task 26（CI 配置）、Task 27（README） |
| Commit | `62b0bcc` |
| 人工干预 | 无 |

### 文档提交与 gitignore 整改

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:35 |
| Commit | `1bde392`（编译修复）、`9e1fbc8`（文档+gitignore） |
| 操作 | 修复 CLI 子任务引入的编译问题 → 提交 `package-lock.json` + 所有交付文档 → 更新 `.gitignore` 排除原始需求文档和 `GIT_PUSH_STRATEGY.md` |
| 人工干预 | 用户要求排除无关文档，手动配置 `.gitignore` 规则 |

### 推送到 GitHub

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 21:37 |
| 操作 | `git push -u origin master` |
| 远程 | `https://github.com/xujianghu/Coding-Agent-Harness.git` |
| 推送 | 24 commits 全部推送成功 |

---

## 2026-08-07 · 最终验证

| 指标 | 结果 |
|------|------|
| 单元测试 | **94 passed** / 22 files / 0 failed |
| 编译 | `tsc --noEmit` 零错误 |
| 演示脚本 | 演示① 10✅ / 演示② 11✅ / 演示③ 23✅ = 44✅ 0❌ |
| Git 历史 | 24 commits，语义明确，每个 commit 对应一个独立功能模块 |
| 无凭据泄露 | 已确认 |

**总结：** 全部 27 个实现 task 通过并行 subagent 派发完成，从 Phase 4 到 Phase 10 共使用 5 轮并行派发（2→4→7→3→2→3），每轮均遵循 TDD 红-绿流程。核心机制全部可用 mock LLM 验证，无真实 LLM 依赖。

---

## 2026-08-07 · P0 架构缺陷修复（基于 OPTIMIZATION_PLAN.md）

### 审查结论

OPTIMIZATION_PLAN.md 提出的 28 条优化项经逐条对照源码验证，**四个 P0 缺陷全部真实存在**。修复方案可行，按 TDD 流程逐一修复。

### P0-1 · LLM Provider 工厂路由

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 23:45 |
| 触发技能 | `subagent-driven-development`（TDD 流程） |
| Commit | `40670eb` |
| 问题 | CLI 硬编码 MockLLM，三个真实适配器已实现但从未接入 |
| 修复 | 新增 `src/llm/factory.ts` + CLI 添加 `--mock` 参数 |
| 测试 | 9 tests PASS，覆盖 mock/openai/anthropic/gemini 四种路由 + 错误处理 |
| 人工干预 | 无 |

### P0-4 · 消息历史裁剪

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 23:47 |
| Commit | `4f5a064` |
| 问题 | `maxConversationTurns` 从未使用，消息数组无限增长 |
| 修复 | 新增 `trimConversationHistory` 函数，每轮迭代后裁剪 |
| 测试 | 新增 4 tests，全量 13 tests PASS |
| 人工干预 | 无 |

### P0-3 · 治理管道全覆盖

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 23:50 |
| Commit | `657d58b` |
| 问题 | 非 shell_exec 动作绕过所有安全检查 |
| 修复 | 将 `if (action.type !== 'shell_exec')` 短路替换为 switch 分支 |
| 测试 | 7 tests PASS，覆盖 shell_exec/write_file/read_file/run_test/run_lint |
| 人工干预 | 无 |

### P0-2 · 标准 Tool-Use 协议支持

| 项目 | 详情 |
|------|------|
| 时间 | 2026-08-07 23:59 |
| Commit | `30aeae8` |
| 问题 | parseResponse 只支持自创 JSON 格式，不支持 OpenAI tool_calls / Anthropic tool_use |
| 修复 | LLMResponse 扩展 toolCalls 字段，三个适配器提取原生格式，parseResponse 优先处理 toolCalls |
| 测试 | 新增 9 tests，全量 122 tests PASS。向后兼容现有 JSON 格式 |
| 人工干预 | 无 |

### 最终验证

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 单元测试 | 94 | **122** |
| 测试文件 | 22 | **23** |
| 编译 | 零错误 | 零错误 |
| 演示脚本 | 44✅ | 44✅（无回归） |
| Git 提交 | 24 | **28** |

**P0 优化总结：** 四个架构缺陷全部修复，真实 LLM 可通过工厂路由接入，标准 Tool-Use 协议已支持，治理管道覆盖所有动作类型，消息历史自动裁剪。项目从"概念演示"升级到"可用原型"。