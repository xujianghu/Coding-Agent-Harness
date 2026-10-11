# 快速开始

[返回项目首页](../README.md) · [配置与安全边界](configuration.md) · [开发与验证](development.md)

先体验无需 API Key 的固定演示，再把 Harness 接到自己的项目。当前源码版本为 `1.1.0`，以下步骤使用 `codex/agent-harness-upgrade` 分支，不表示该版本已经发布到 npm。

## 安装源码

需要 Node.js `22.12+`（22 系列）或 `24+` 和 npm。真实任务默认使用 Docker 执行命令，需要启动 Docker；Windows 使用 Linux 容器。固定离线演示使用本地执行器，无需 Docker 或模型凭据。

```bash
git clone --branch codex/agent-harness-upgrade https://github.com/xujianghu/Coding-Agent-Harness.git
cd Coding-Agent-Harness
npm ci
npm run build
```

构建会生成 CLI 和前端。可选执行 `npm link`，获得 `harness` 和 `harness-eval` 命令；不使用全局链接时，分别运行 `node dist/cli/index.js` 和 `node dist/eval/cli.js`。

## 无需 Key 的工作台演示

在仓库目录运行：

```bash
node dist/cli/index.js init
npm run web
```

浏览器打开终端输出的地址，默认是 `http://127.0.0.1:4173/`。

1. 新建会话，选择“机制演示”。创建空会话不会调用模型。
2. 发送一条需求，观察文件读取、补丁、工具结果和待审批动作。
3. 批准测试动作，查看验收结果和右侧 Diff。
4. 在同一会话追加消息，查看保留下来的文件和新一轮修改。

演示使用固定响应：首轮创建 `amount.js`，将金额计算中的加法修正为乘法；后续轮次读取已修文件，并向 `notes.md` 追加需求说明。文件修改和测试会真实执行，每个演示会话拥有 `.harness/web-demo/<conversationId>/` 下的独立工作区。它不会修改启动项目源码，也不具备离线理解任意任务的能力。

只验证命令行管道时，可运行：

```bash
node dist/cli/index.js run "离线机制自检" --mock
npm run eval:smoke
```

`run --mock` 返回预设完成消息，不执行任意修复；`eval:smoke` 在固定任务集上执行预设修复脚本。两者都不调用真实模型，也不能作为模型编码成功率。

## 执行真实任务

先准备 Docker 镜像和目标项目依赖。默认工具容器禁止联网，镜像不会自动拉取，执行期间也无法通过 `npm install` 下载依赖。

```bash
docker pull node:22-alpine
npm link
```

进入目标项目目录，然后初始化并配置凭据：

```bash
harness init
harness key set openai
harness run "修复分页边界错误，保持现有接口并补充回归用例" --verify "npm test"
```

在尚无配置的新项目中，`harness init` 默认生成 OpenAI 和 `gpt-4o` 配置；它不会覆盖已有文件。本仓库随源码附带无密钥的 DeepSeek 兼容服务示例，克隆后执行 `init` 会保留这个示例。运行前检查 `.harness/config.yaml` 的 `llm.provider`、`llm.model` 和 `llm.baseUrl`：使用官方 OpenAI 时移除 DeepSeek 的 `baseUrl`，使用其他提供商时按需调整。可使用 OpenAI、Anthropic 或 Gemini。配置凭据与任务执行应使用同一目标工作区，真实运行会产生模型 API 费用。Key 环境变量、兼容服务和 Java 工具镜像见 [配置指南](configuration.md)。

`--verify` 在模型声明完成时运行工程检查；失败结果会反馈给模型，直至通过或达到预算。未指定验收命令时，任务可以显示 `completed`，但 `verified` 为 `false`。任务未完成或指定验收未通过时，CLI 返回非零退出码。工作区检查适合开发反馈，独立评测的隐藏验收才用于衡量编码结果。

### 常用 CLI 参数

| 参数 | 作用 |
| --- | --- |
| `-w, --workspace <path>` | 目标工作区，默认当前目录 |
| `-c, --config <path>` | 配置路径，相对工作区解析，默认 `.harness/config.yaml` |
| `--verify <command>` | 声明完成后必须通过的验收命令 |
| `--execution docker` | 使用默认容器执行器 |
| `--execution local` | 显式使用宿主执行器，无容器隔离 |
| `--dry-run` | 跳过工具动作并展示治理决策，仍可能调用真实模型 |
| `-m, --mock` | 固定离线机制自检 |
| `-v, --verbose` | 显示模型消息与工具结果 |

运行 `harness chat` 或直接运行 `harness` 可进入交互模式，输入 `exit`、`quit` 或 `q` 退出。交互模式经过工具治理，但不执行 `run` 的完成验收流程。

## 在工作台使用自己的项目

目标项目完成初始化后，从任意目录指定它：

```bash
harness web -w /path/to/project --port 4173
```

新建会话时选择真实模型、执行模式和验收命令。真实模式读取启动工作区已有配置与凭据，发送消息才开始调用模型。

左侧切换会话，中间查看连续对话与审批，右侧只读浏览当前文件、所选运行的 Diff 和执行详情。历史与评测页面可查看保存的运行记录和评测报告。状态通过 SSE 更新，每个 `event: run` 携带有界运行快照，当前不是模型逐 Token 输出。

一条消息对应一个运行（run）。完成后追加消息会安全继承上一轮上下文，并开始新的预算；恢复中断运行则沿用原运行的累计预算。上一轮有结果不确定的动作、待处理工具调用或协议不完整时，服务会阻止继续发送；改变配置或护栏后需要创建新会话。详细规则见 [检查点与恢复](configuration.md#检查点与恢复)。

服务面向本机单用户，仅监听回环地址，同一服务一次只执行一个 run。真实会话共享启动工作区，当前没有多项目切换、worktree 隔离、多用户登录和网页代码编辑功能。文件和 Diff 预览受大小与敏感路径限制，差异可能截断。

## 开发前端

首次先安装依赖并构建后端。在仓库目录打开两个终端：

```bash
# 终端一：启动后端
npm run web
```

```bash
# 终端二：启动 Vite
npm run dev:web
```

访问 `http://127.0.0.1:5173/`。Vite 将 `/api` 代理到后端的 `4173` 端口，后端改用其他端口时需要同步修改 `frontend/vite.config.mts`。修改后端源码后重新运行 `npm run build` 并重启后端；前端开发服务支持热更新。

## 常见启动问题

| 现象 | 处理方式 |
| --- | --- |
| 找不到 `harness` 命令 | 执行 `npm link`，或使用构建后的 `node dist/cli/index.js` |
| 缺少护栏文件 | 在目标工作区执行 `harness init` |
| Docker 不可用或镜像缺失 | 启动 Docker，确认使用 Linux 容器，并提前拉取配置中的镜像；不会自动退回 `local` |
| 容器中找不到 Maven、git 或依赖 | 预先构建匹配项目的工具镜像，并配置命令白名单 |
| Key 未配置 | 在目标工作区设置所选提供商凭据，或为启动进程提供相应环境变量 |
| 开发页面访问 API 失败 | 确认后端运行在 `4173`，并使用 Vite 输出的本地地址 |

更多排查与验证命令见 [开发指南](development.md)。
