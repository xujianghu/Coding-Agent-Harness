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