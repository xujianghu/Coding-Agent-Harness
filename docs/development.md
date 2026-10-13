# 开发与验证

[返回项目首页](../README.md) · [快速开始](getting-started.md) · [配置与安全边界](configuration.md) · [架构说明](architecture.md)

文档更新：2026-10-13。

本项目使用 TypeScript 构建 Harness，前端使用 React 和 Vite。Node.js 要求为 `^22.12.0 || >=24`，CI 使用 Node.js 24。

## 开发命令

```bash
npm ci
npm run build
npm test
npm run demo
npm run eval:smoke
npm run test:package
```

<!-- AUTO-GENERATED: 根据 package.json 的 scripts 同步 -->

| 命令 | 内容 |
| --- | --- |
| `npm run build` | 编译后端、检查前端 TypeScript 并生成生产页面 |
| `npm run build:web` | 单独检查前端 TypeScript 并生成生产页面 |
| `npm run dev:web` | 启动 Vite 前端开发服务 |
| `npm run web` | 启动已构建的本地工作台服务 |
| `npm test` | 单元与集成测试；真实 Docker 用例默认不启用 |
| `npm run test:watch` | 监听模式运行测试 |
| `npm run test:docker` | 单独运行实际 Docker 执行与评分测试 |
| `npm run demo` | 三个固定机制示例 |
| `npm run eval -- <参数>` | 启动评测 CLI，真实模式需要显式配置与凭据 |
| `npm run eval:smoke` | 10 个固定任务在三种模式下的 mock 自检 |
| `npm run test:package` | 将包安装到临时目录，检查两个 CLI、包内评测资产、工作台页面/API、会话和事件流；实际覆盖范围以脚本为准 |
| `npm run check` | 汇总构建、单元测试、mock 评测和打包检查；不包含 Docker 测试与 `demo` |
| `npm start -- <参数>` | 启动已构建的 Harness CLI，默认进入交互模式 |

<!-- /AUTO-GENERATED -->

`test:package` 需要已有构建产物，应在 `npm run build` 后执行；通过 npm 启动，以便脚本找到 npm CLI。当前没有独立的 ESLint 脚本，编译或测试通过不能称为 ESLint 检查通过。

真实容器测试单独运行：

```bash
docker pull node:22-alpine
npm run test:docker
```

该脚本通过 `HARNESS_DOCKER_TESTS=1` 运行 `tests/tools/executor-docker.test.ts` 和 `tests/eval/`，覆盖实际容器边界、超时、取消与候选评分。普通测试通过不能替代这项检查。

前端双终端开发和首次使用见 [快速开始](getting-started.md#开发前端)。生产页面输出到 `dist/web-ui/`，并随 npm 包发布。

本地项目选择与切换由 `src/web/projects.ts` 管理，配置初始化位于 `src/config/initialize.ts`，项目回归用例位于 `tests/web/projects.test.ts`。修改这些流程时需检查未初始化目录浏览、配置不覆盖、执行中切换拒绝、项目历史隔离、旧请求与 SSE 失效。网页操作检查记录见 [工作台功能验收](workbench-verification.md)，mock 页面演示仍不能证明真实模型编码成功率。

## 可复现评测

固定任务清单位于 [eval/manifest.json](../eval/manifest.json)，包含 10 个小型 JavaScript 修复任务，覆盖单文件边界、多文件金额计算、代码定位、CSV 转义、特殊键分组与异步重试。

| 模式 | 执行与评分 |
| --- | --- |
| `baseline` | 模型声明完成后停止，最后独立验收 |
| `full` | 声明完成时运行公开测试，失败诊断反馈给模型继续修复，最后独立验收 |
| `no-feedback` | 保留测试与失败状态，移除失败诊断，最后独立验收 |

各模式使用相同模型、工具和预算，最终使用候选工作区外的隐藏验收评分。任务布局、评分协议、修改范围和报告字段详见 [评测说明](../eval/README.md)。

无需凭据的管道自检：

```bash
npm run build
npm run eval:smoke
```

mock 在宿主临时工作区执行固定修复脚本与候选子进程，不提供 Docker 隔离，也不衡量模型能力。

真实评测必须准备显式配置、凭据和执行镜像，会产生 API 费用，并强制使用 Docker：

```bash
harness-eval --config .harness/config.yaml --mode all --repeat 3
harness-eval --config .harness/config.yaml --mode full --tasks 01-clamp,05-cart --repeat 2
```

没有全局链接时，将 `harness-eval` 换成 `node dist/eval/cli.js`。配置、凭据和输出参数相对启动目录解析，默认凭据目录是 `.harness/credentials`，报告输出到 `.harness/eval-results/<run-id>/`。运行 `harness-eval --help` 查看全部参数。

报告包含逐次结果、候选源码、diff、轨迹与复现信息。失败尝试计入分母；真实 usage 与估算 usage 分别记录，无法确认的 API 用量单独标记，未核实定价时费用保持未知。

仓库不预设真实模型成功率。展示效果时，记录实际模型、任务数、重复次数、基线差异和对应报告；这 10 个小任务的结果不能外推为大型仓库能力。

## CI 与打包

[CI 工作流](../.github/workflows/ci.yml) 在 Windows 与 Ubuntu 上运行构建、单元测试、机制演示、mock 评测和安装检查；另设 Ubuntu Docker 测试任务。修改公共执行流程时，同时关注跨平台作业与实际容器作业。

查看包内文件可使用：

```bash
npm pack --dry-run
```

发布文件范围由 `package.json` 的 `files` 控制，包括 `dist/`、`eval/`、`docs/`、README、CONTRIBUTING 和 `Dockerfile.sandbox`。源码版本号与 npm 已发布版本是两个事实，应以实际发布结果为准。

仓库根目录 `Dockerfile` 用于打包 CLI，构建前需要生成 `dist/`：

```bash
npm run build
docker build -t coding-agent-harness:local .
docker run --rm coding-agent-harness:local --help
```

这个 CLI 镜像不包含 Docker CLI，也没有默认执行器所需的宿主 Docker 连接。通常在宿主运行 Harness，配合 `Dockerfile.sandbox` 生成的工具镜像执行任务。

## 目录职责

```text
src/core/          主循环、交互循环、预算与检查点协议
src/llm/           原生工具调用适配与 mock
src/tools/         文件定位、补丁和统一执行器
src/governance/    护栏、审批、边界检查与审计
src/credential/    模型凭据管理
src/config/        配置合并、校验与缺失文件初始化
src/cli/           任务 CLI、会话存储与轨迹
src/web/           本地项目选择、工作台 API、会话与运行服务
frontend/          React 工作台与响应式样式
src/eval/          评测运行、独立评分与报告
eval/              固定任务、公开测试、隐藏验收与 mock 修复
tests/             单元、集成和真实 Docker 测试
scripts/           打包与容器验证脚本
demo/              固定机制演示
docs/              使用、设计与项目展示文档
```

## 贡献流程

1. 从明确的问题或可复现失败出发，创建独立分支。
2. 改动前阅读对应模块、测试和 [架构说明](architecture.md)，明确输入、预算、审批与恢复语义。
3. 对行为变化添加必要回归测试，尤其关注取消、工具消息配对、审批后复查和检查点恢复。
4. 运行与改动相关的测试；合并前运行 `npm run check`。涉及容器执行时另外运行 `npm run test:docker`。
5. 同步使用文档，在 PR 中说明问题、最终行为、验证结果及尚未覆盖的边界。

固定任务、mock 自检和真实模型实验应分别记录。开发时使用多代理协作不代表产品已经内置多 Agent 调度。

## Windows 注意事项

- 确认 `node --version` 满足要求，避免系统 PATH 中旧 Node 运行 Vite 或测试。
- 本文命令可逐行在 PowerShell 执行；环境变量语法使用 `$env:NAME`，与 Bash 的 `export` 不同。
- 工作区路径含空格时为参数加引号，例如 `harness web -w "D:\My Projects\demo"`。
- Docker Desktop 需要启动并使用 Linux 容器；宿主预装的 Windows 原生依赖不一定可在 Linux 镜像中使用。
- API Key 输入需要交互式终端；流水线改用提供商环境变量。不要将带 Key 的命令保存到共享脚本或截图。
