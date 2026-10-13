# 配置、执行与恢复

[返回项目首页](../README.md) · [快速开始](getting-started.md) · [开发与验证](development.md)

文档更新：2026-10-13。

本指南说明模型、预算、工具执行和持久化的实际边界。CLI 任务工作区通过 `-w` 指定；网页可以打开和切换本地项目。`run` 和 `session resume` 的 `-c` 相对工作区解析，默认读取 `.harness/config.yaml`。

## 配置文件

在目标工作区执行 `harness init`，生成配置与护栏文件；已有文件会保留。新项目的初始化默认值为 OpenAI / `gpt-4o`；仓库附带的 `.harness/config.yaml` 则是无密钥的 DeepSeek 兼容服务示例，使用 `provider: openai`、`model: deepseek-chat` 和 `baseUrl: https://api.deepseek.com`。使用官方 OpenAI 时应移除这个示例端点，并选择自己可用的模型。

加载器将 YAML 与代码默认值递归合并，数组由配置值替换。下面是主要设置，模型名应替换为自己可用的模型：

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

governance:
  rulesFile: .harness/guardrails.yaml
  sandbox:
    allowedPaths:
      - ./
    allowedCommands:
      - npm
      - node
      - npx
      - tsc
      - eslint
      - vitest
      - jest
      - git

memory:
  storagePath: .harness/memory/
  maxConversationTurns: 20
  maxContextTokens: 16000
  maxToolOutputChars: 12000
```

| 设置 | 含义 |
| --- | --- |
| `llm.provider` | `openai`、`anthropic` 或 `gemini` |
| `llm.maxTokens` | 单次模型回复的输出 Token 上限 |
| `llm.temperature` | 采样参数，配置校验范围为 `0–2`，仍需满足所选模型约束 |
| `agent.maxTurns` | 单次运行累计轮次上限 |
| `agent.timeout` | 单次运行累计时间预算，单位毫秒 |
| `agent.maxTotalTokens` | 单次运行累计 Token 预算 |
| `execution.timeout` | 单次命令执行超时，单位毫秒 |
| `memory.maxContextTokens` | 上下文裁剪预算 |
| `memory.maxToolOutputChars` | 单条工具输出的保留字符上限 |

上下文按完整工具调用与结果组裁剪。Token 优先使用提供商返回的 usage，缺失时估算并标记；估算不等于实际计费。`memory.storagePath` 是配置项，不代表已经实现长期语义记忆或向量检索。

OpenAI 兼容服务使用 `llm.provider: openai` 和 `llm.baseUrl`，凭据仍使用 OpenAI 配置项。当前 `baseUrl` 仅传给 OpenAI 适配器，服务须支持所选模型的工具调用协议。

## 模型凭据

在目标项目目录管理 Key：

```bash
harness key set openai
harness key status
harness key clear openai
```

提供商名也可换成 `anthropic` 或 `gemini`。`set` 需要交互式终端，输入不会回显原文；`status` 只显示是否配置。该命令使用当前目录的 `.harness/credentials/`，没有 `-w` 参数。

| 环境变量 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI 或 OpenAI 兼容服务 Key |
| `ANTHROPIC_API_KEY` | Anthropic Key |
| `GEMINI_API_KEY` | Gemini Key |
| `HARNESS_MASTER_PASSWORD` | 凭据文件加密主密码 |

读取时优先使用凭据文件，没有可用 Key 时再读取提供商环境变量。凭据保存在 `.harness/credentials/credentials.json`：设置主密码时使用 AES-256-GCM；未设置时使用明文 JSON 并告警。主密码本身不落盘，读取加密文件需使用同一主密码。切换加密方式不会自动迁移既有文件。

模型 API 请求由宿主 Harness 进程发起，模型 Key 不作为环境变量传入工具进程。不要把真实 Key 写入仓库示例配置、Issue、截图或评测报告。

## 执行模式与镜像

| 模式 | 执行位置与约束 |
| --- | --- |
| `docker` | 默认模式；容器禁网、根文件系统只读、禁止提权，并限制 CPU、内存、进程数与输出 |
| `local` | 显式启用；经过命令治理和进程控制，但命令仍具有宿主用户权限，可访问宿主文件系统 |

Docker 不可用时不会自动回退到 `local`。工作台机制演示和 mock 评测使用固定本地资产，通过 `local` 执行；这类结果不代表 Docker 隔离已经通过验证。

默认镜像 `node:22-alpine` 只有基础 Node 环境，不含 git、Maven 或目标项目依赖。镜像必须提前准备，任务容器无法联网安装依赖。仓库提供 Node/git 工具镜像：

```bash
docker build -f Dockerfile.sandbox -t harness-tools:local .
```

将 `execution.image` 改为 `harness-tools:local` 即可使用。Java 项目需预先准备包含 JDK、Maven 和依赖缓存的 Linux 镜像，并把 `java`、`mvn` 等命令加入 `governance.sandbox.allowedCommands`。当前默认镜像和内置评测集不提供 Java 环境或 Java 能力测评。Windows 宿主项目的原生依赖也需要与 Linux 容器运行环境匹配。

Docker 工作区以可写目录挂载到 `/workspace`。已有 `.git`、`.harness`、`.env`、`.env.*`、密钥文件、`.ssh`、`.aws` 等敏感条目会以只读空挂载覆盖，容器不能读取原始 Git 元数据或这些配置。执行器在超时或取消时清理进程与容器。容器隔离不等于多租户服务隔离，也不能保证抵御所有内核漏洞。

## 护栏与审批

命令、测试和 lint 统一经过护栏、命令白名单与审批；文件动作经过真实路径、敏感路径和 `type: file` 规则检查，删除需审批。审批后重新检查策略，批准不能解除硬性拦截。

初始化规则与仓库内 `.harness/guardrails.yaml` 是可配置示例，应根据目标项目调整。缺失或无效护栏文件会阻止启动；运行时重载失败会保留上一份有效规则。文件工具拒绝工作区外访问，并检查符号链接和硬链接。

CLI 的待审批动作需要交互式终端，非交互执行不会自动批准。工作台通过页面处理审批。正则规则和命令白名单是治理机制，不能证明任意工作区源码安全。

## 检查点与恢复

CLI `run` 自动保存检查点和轨迹：

```bash
harness session resume <id>
harness session resume
```

省略 ID 时选择最近保存的会话。恢复保留消息、工具历史、累计轮次、Token 和已消耗时间，不重置预算。配置、护栏规则、受指纹检查的工作区文件或原验收命令改变时拒绝恢复；已完成运行应以新任务开始。

如果动作已经启动但结果尚未确定，检查点标记 `executionUncertain`，框架拒绝自动重放。先检查工作区和动作效果，再决定启动新任务。恢复不会重新执行已记录完成的工具动作。

工作区指纹排除 `.git`、`.harness`、`node_modules`、`dist`、`coverage`、`target` 等目录以及敏感条目，因此不保证依赖与构建产物完全一致。

工作台连续对话与恢复有不同语义：

| 操作 | 运行与预算 |
| --- | --- |
| 同一会话发送新消息 | 创建新 run，继承安全校验通过的旧上下文，使用新预算 |
| 恢复中断 run | 继续原 run，沿用累计预算 |

创建会话时固定机制演示/真实模式、执行模式、验收命令和配置指纹。上一轮结果不确定、存在待处理工具调用或消息协议不完整时，不能继续发送；配置或护栏变化时需创建新会话。只能恢复会话的最新 run，避免分叉后写入同一工作区。CLI mock 或来源未知的旧记录需用原 CLI 模式恢复；无检查点的失败记录只能查看错误。

## 本地数据与服务边界

下表路径相对所属项目。项目切换后，工作台读取该项目的会话、运行、文件和评测报告。同一项目的真实会话共享源码目录；机制演示仍使用该项目下的独立演示目录。

| 路径 | 内容 |
| --- | --- |
| `.harness/config.yaml` | 模型、预算与执行设置 |
| `.harness/guardrails.yaml` | 护栏规则 |
| `.harness/credentials/` | 本工作区的模型凭据 |
| `.harness/sessions/<id>.json` | CLI 及工作台运行检查点 |
| `.harness/runs/<id>.jsonl` | 治理、审批、工具、验收和终止轨迹 |
| `.harness/web-conversations/` | 工作台会话元数据 |
| `.harness/web-runs/` | 工作台运行记录 |
| `.harness/web-demo/<conversationId>/` | 独立机制演示工作区 |
| `.harness/eval-results/<run-id>/` | 评测报告与候选产物 |

最近项目索引位于**服务启动项目**的 `.harness/web-projects.json`，保存最近打开的最多 20 个路径和时间；切换后的项目数据仍保存在对应项目目录。重启以启动参数指定项目为当前项目，不自动打开最近目录。索引失效或目录不可用时不会自动初始化该目录。

打开未初始化目录可只读浏览文件并使用机制演示。默认打开不生成配置，也不调用模型；勾选初始化才创建缺失的 `.harness/config.yaml` 和 `.harness/guardrails.yaml`，不会覆盖已有文件。创建会话或运行演示会保存对应本地状态；真实模式需要有效配置、护栏及凭据。

轨迹和报告可能包含源码及命令输出，分享前检查内容。服务仅监听回环地址，并校验 Host、Origin 和请求格式；面向本机单用户，一次只执行一个 run。执行或等待审批时拒绝项目切换；旧页面携带过期项目标识的请求会被拒绝，切换时旧 SSE 连接关闭。没有 Git worktree 隔离或用户认证，当前不适合直接开放到公网。

文件浏览只读，限制大文件、二进制、链接和敏感条目；Diff 有界且可能截断。界面能显示的预览不等于完整文件或完整修改审查。
