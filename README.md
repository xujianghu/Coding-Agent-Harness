# Coding Agent Harness

一个用 TypeScript 实现的编码智能体执行框架，包含 CLI 和 React 工作台。它将模型工具调用、动作治理、隔离执行、任务验收和会话恢复接成可追踪的执行流程，并提供固定任务集，用于比较不同反馈机制对编码结果的影响。

当前升级版本为 `1.1.0`，请从 `codex/agent-harness-upgrade` 分支源码安装；本文不代表该版本已发布到 npm。离线演示和 mock 评测只验证执行机制，不能证明真实模型的编码能力。

## 核心能力

- 支持 OpenAI、Anthropic、Gemini 原生工具调用，保留调用 ID 和结果对应关系；支持文本 JSON 动作回退。
- 提供文件读写、删除、文件搜索、字面代码搜索、分段读取、精确补丁、命令、测试和 lint 工具。补丁支持文件 SHA-256 校验，拒绝多处匹配和过期修改。
- 对 Shell、测试、lint 统一执行命令策略；审批后重新校验边界，审批不能解除硬性拦截。
- 默认在 Docker 中执行命令，限制网络、文件系统、权限、内存、CPU、进程数和输出；超时或取消时清理进程与容器。
- 将 `completed` 与 `verified` 分开：模型宣告结束不等于验收通过；验证失败可继续修复。
- 使用累计轮次、时间和 Token 预算，按完整工具消息组裁剪上下文；持久化检查点和 JSONL 轨迹。
- 内置 10 个 Node.js 修复任务，支持 `baseline`、`full`、`no-feedback` 对照，产出独立验收结果、补丁和调用轨迹。

架构和执行边界见 [架构说明](docs/architecture.md)。

用于作品展示和面试时，可参考 [演示步骤与简历表达](docs/project-showcase.md)。

## 前端工作台

![Harness Studio 工作台预览](docs/ui-preview.jpg)

编译后运行 `npm run web`，在浏览器打开终端输出的本地地址（默认 `http://127.0.0.1:4173`）。也可以使用 `harness web -w <工作区> --port 4173` 指定目标项目；项目需先运行 `harness init`。

工作台支持提交任务、跟踪模型与工具事件、人工审批、取消运行、查看代码差异、安全恢复和浏览历史评测报告。离线演示会在独立演示工作区执行真实文件工具及验收，明确标为 mock，不会修改当前项目源码。真实任务使用已有模型配置和凭据，产生正常 API 费用。

历史页也读取命令行会话，并区分工作台演示、命令行离线自检与真实模型任务。命令行离线会话或来源未知的旧会话需通过原 CLI 模式恢复；启动失败但没有检查点的任务保留错误记录，不能恢复。服务重启时分别载入最近 100 条工作台记录和命令行会话。

服务仅监听本机回环地址，校验 Host、Origin 和 JSON 请求，工作区由启动参数固定。它面向本机单用户，具有执行该用户编码任务的权限；当前没有登录或多用户机制，不能直接开放到公网。

前端使用 React、TypeScript 和 Vite，源代码位于 `frontend/`。开发时先启动后端，再运行 `npm run dev:web`；生产构建随 `npm run build` 生成并打入 npm 包。

## 从源码安装

需要 Node.js `22.12+`（22 系列）或 `24+`、npm，以及用于默认命令执行的 Docker。先启动 Docker，并提前准备执行镜像。

```bash
git clone --branch codex/agent-harness-upgrade https://github.com/xujianghu/Coding-Agent-Harness.git
cd Coding-Agent-Harness
npm ci
npm run build
npm link
docker pull node:22-alpine
```

`harness` 是任务 CLI，`harness-eval` 是评测 CLI。不使用全局链接时，可分别运行 `node dist/cli/index.js` 和 `node dist/eval/cli.js`。

## 执行一个任务

在目标项目目录中初始化配置，再配置所选提供商的凭据。`harness init` 生成的配置默认使用 OpenAI；请根据可用模型修改 `.harness/config.yaml` 中的提供商和模型名。

```bash
harness init
harness key set openai
harness run "修复分页边界错误，保持现有接口并补充回归用例" --verify "npm test"
```

默认 Docker 执行禁止联网，镜像不会自动拉取。目标项目的依赖必须提前安装，或预先构建包含依赖的执行镜像；命令执行期间 `npm install` 无法访问网络。宿主进程向模型 API 发起请求，模型 Key 不会作为环境变量传入工具进程。

| 参数 | 作用 |
| --- | --- |
| `-w, --workspace <path>` | 目标工作区，默认当前目录 |
| `-c, --config <path>` | 配置文件，相对工作区解析，默认 `.harness/config.yaml` |
| `--verify <command>` | 模型声明完成时运行的验收命令 |
| `--execution docker` | 使用隔离命令执行器，默认模式 |
| `--execution local` | 显式使用宿主命令执行器，无容器隔离 |
| `--dry-run` | 展示治理决策并跳过工具动作，仍可能调用真实模型 |
| `-m, --mock` | 离线机制自检，不调用真实模型 |
| `-v, --verbose` | 输出模型消息和工具结果 |

未提供 `--verify` 时，任务可以显示 `completed`，但 `verified` 仍为 `false`。指定验收命令后，失败结果会反馈给模型，直到通过或触及预算。CLI 会在任务未完成或指定验收未通过时返回非零退出码。

`--verify` 是工作区中的工程检查，适合开发反馈；Agent 可以修改工作区源码，它不能替代独立评测中的隐藏验收。

交互模式使用 `harness chat` 或直接运行 `harness`，输入 `exit`、`quit` 或 `q` 退出。交互模式提供工具治理，但不执行 `run` 的完成验收流程。

## 配置与执行镜像

下例展示主要预算和执行设置，其余设置可保留 `harness init` 生成的内容：

```yaml
llm:
  provider: openai
  model: gpt-4o
  maxTokens: 4096
  temperature: 0.1
  # baseUrl: https://your-openai-compatible-service.example

agent:
  maxTurns: 50
  timeout: 300000
  maxTotalTokens: 100000

execution:
  mode: docker
  image: node:22-alpine
  timeout: 120000

memory:
  maxConversationTurns: 20
  maxContextTokens: 16000
  maxToolOutputChars: 12000
```

时间配置单位为毫秒。Token 预算使用提供商返回的 usage；未返回 usage 时进行估算并明确标记，不能将估算值作为实际计费数据。

`node:22-alpine` 只有基础 Node 运行环境，不包含 git、Maven 或项目依赖。仓库提供的 `Dockerfile.sandbox` 是可提前构建的 Node/git 工具镜像：

```bash
docker build -f Dockerfile.sandbox -t harness-tools:local .
```

之后将 `execution.image` 改为 `harness-tools:local`。Java 项目可预先构建包含 JDK、Maven 和依赖缓存的 Linux 镜像，并把 `java`、`mvn` 等所需命令加入 `governance.sandbox.allowedCommands`。默认工具镜像和当前评测任务集不提供 Java 环境或 Java 能力测评。

OpenAI 兼容服务可通过 `llm.baseUrl` 接入，凭据仍使用 `openai` 配置项；服务需要支持所用模型的工具调用协议。

## 检查点与恢复

`run` 自动保存 `.harness/sessions/<id>.json` 和 `.harness/runs/<id>.jsonl`。命令行会输出会话 ID，恢复时使用：

```bash
harness session resume <id>
harness session resume
```

省略 ID 时选择最近保存的会话。恢复会保留消息、工具历史、累计轮次、Token 和已消耗时间，不重置预算；配置、护栏规则、受指纹检查的工作区文件或原验收命令改变时会拒绝恢复。已完成会话也需要以新任务启动。

如果动作已经启动却未得到确定结果，检查点会标记执行状态不确定，并拒绝自动重放。此时先检查工作区和动作效果，再启动新任务。工作区指纹排除 `.git`、`.harness`、`node_modules`、`dist`、`coverage`、`target` 等目录，因此它不保证依赖和构建产物完全一致。

轨迹记录治理、审批、工具结果、验证和终止原因；文件可能包含项目源码与命令输出，分享前需要检查内容。

## 可复现评测

任务清单在 [eval/manifest.json](eval/manifest.json)，覆盖单文件边界、多文件金额计算、代码定位、CSV 转义、特殊键分组和异步重试。每次尝试创建独立工作区，模型只看到任务提示、源码和公开测试；隐藏验收不放入候选工作区。

| 模式 | 完成条件与反馈 |
| --- | --- |
| `baseline` | 模型声明完成后停止，最后由独立验收评分 |
| `full` | 声明完成时先跑公开测试；失败诊断反馈给模型继续修复，最后独立评分 |
| `no-feedback` | 保留测试和失败状态，移除失败诊断；最后独立评分 |

三个模式使用相同模型、工具和预算。隐藏验收由可信父进程保留断言，候选实现通过独立进程或容器中的受限调用返回结果；候选程序打印成功文字或自行退出不能替代验收。评分同时检查允许修改的源码范围，修改公开测试、配置或额外文件会被判定失败。

先运行无需 Key 的机制自检：

```bash
npm run build
npm run eval:smoke
```

mock 会执行预设修复脚本，验证任务复制、执行、评分和报告机制，其通过率不进入真实模型能力结论。它在宿主临时工作区和候选子进程中执行，不提供 Docker 隔离，仅用于本仓库的固定任务资产。

真实评测会产生模型 API 费用。准备显式配置与凭据后运行：

```bash
harness-eval --config .harness/config.yaml --mode all --repeat 3
harness-eval --config .harness/config.yaml --mode full --tasks 01-clamp,05-cart --repeat 2
```

真实模式强制使用 Docker。默认报告输出到 `.harness/eval-results/<run-id>/`，包含 `report.md`、逐次结果、候选源码、diff 和轨迹。记录任务清单哈希、Harness 源码哈希与 Git 状态、模型参数、预算、轮次、时间、真实 usage 与估算 usage；失败尝试计入分母，无法确认的 API 用量单独标记，费用保持未知。

本仓库提供评测管道和任务，不预设真实模型成功率。用于简历时，应填写自己实际运行的模型、任务数、重复次数、基线差异和成本数据，并保留对应报告。目前 10 个小型 JavaScript 任务的结果不能外推为大型仓库或通用编码能力。

## 治理与边界

命令动作经过护栏规则、命令白名单和审批，文件动作经过真实路径检查与 `type: file` 规则，删除需要审批。初始化规则与本仓库的 `.harness/guardrails.yaml` 是可配置示例，应按目标项目审查。缺失或无效护栏文件会阻止启动，运行时规则重载失败会保留上一份有效规则。

文件工具检查真实路径、符号链接和硬链接，拒绝工作区外访问和敏感条目。Docker 命令执行使用 `--network none`、只读根文件系统、移除 Linux capabilities、禁止提权、资源上限和可写临时目录；目标工作区作为可写挂载提供给任务。工作区内已有的 `.git`、`.harness`、`.env`、`.env.*`、密钥文件及 `.ssh`、`.aws` 等敏感条目会用只读空挂载覆盖，因此容器内不能使用原始 Git 元数据或读取这些配置。

`local` 只提供策略和进程控制，命令仍拥有宿主用户权限，能够访问宿主文件系统。Docker 不可用时不会自动退回 `local`。正则规则和命令白名单不能证明任意源码安全；框架也不提供多租户隔离或针对所有内核漏洞的防护。

凭据可通过 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY` 环境变量提供，也可用 `harness key set/status/clear` 管理。Key 文件保存在当前工作区的 `.harness/credentials/credentials.json`；设置 `HARNESS_MASTER_PASSWORD` 后使用 AES-256-GCM 加密，未设置时使用明文 JSON 并显示告警。主密码本身不落盘，Key 输入不回显原文，`key status` 只显示是否配置。

## 开发与验证

```bash
npm ci
npm run build
npm test
npm run demo
npm run eval:smoke
npm run test:package
docker pull node:22-alpine
npm run test:docker
```

`test:package` 将 npm 包安装到临时目录，检查两个 CLI 和内置任务是否可用。`test:docker` 执行真实容器边界、超时与取消测试；普通单元测试不等同于真实容器测试。`npm run check` 汇总编译、单元测试、mock 评测和打包检查，Docker 测试单独执行。

CI 在 Windows 和 Ubuntu 上执行编译、单元测试、机制演示、mock 评测和安装检查，另设 Ubuntu Docker 测试任务。

仓库根目录的 `Dockerfile` 用于打包 CLI，需先运行 `npm run build`。它不包含 Docker CLI，也不提供默认执行器所需的宿主 Docker 连接；一般使用宿主安装的 Harness 搭配 `Dockerfile.sandbox` 工具镜像。

```bash
docker build -t coding-agent-harness:local .
docker run --rm coding-agent-harness:local --help
```

## 目录

```text
src/core/          主循环、交互循环、预算与检查点协议
src/llm/           原生工具调用适配与 mock
src/tools/         文件定位、补丁和统一执行器
src/governance/    护栏、审批、边界检查、审计
src/cli/           任务 CLI、会话存储与轨迹
src/web/           本地工作台 API 与任务服务
frontend/          React 工作台与响应式样式
src/eval/          评测运行、独立评分和报告
eval/              固定任务、公开测试、隐藏验收与 mock 修复
tests/             回归、集成、真实 Docker 测试
demo/              机制演示
```
