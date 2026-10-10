#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, validateConfig } from '../config/loader';
import { createToolRegistry } from '../tools/registry';
import { createGuardrailEngine } from '../governance/guardrail';
import { createGuardrailWatcher } from '../governance/watcher';
import { createHITL } from '../governance/hitl';
import { createSandbox } from '../governance/sandbox';
import { createGovernancePipeline } from '../governance/pipeline';
import { createAuditLogger } from '../governance/audit';
import { GuardrailRule } from '../governance/rules';
import { createMockLLM } from '../llm/mock';
import { createLLMProvider } from '../llm/factory';
import { createAgentLoop } from '../core/loop';
import { createChatLoop } from '../core/chat';
import { createCredentialManager } from '../credential/manager';
import { AgentConfig, LLMResponse } from '../core/types';
import * as readline from 'readline';
import * as readlinePromises from 'readline/promises';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, isAbsolute } from 'path';
import { randomUUID } from 'crypto';
import { createWorkspaceTools } from '../tools/workspace';
import { createCommandExecutor } from '../tools/executor';
import { saveSession, loadSession, assertSessionUnchanged, sessionConfigHash, StoredSession } from './checkpoint';
import { createRunTrace, traceProvider } from './trace';
import { loadGuardrailRules } from '../governance/load-rules';
import { startWebServer } from '../web/server';

function hiddenPrompt(query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('密钥输入需要交互式终端，请使用提供商环境变量'));
      return;
    }
    const wasRaw = stdin.isRaw;
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };
    const onEnd = () => { cleanup(); reject(new Error('密钥输入已结束')); };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\x03') { cleanup(); reject(new Error('用户取消密钥输入')); return; }
        if (char === '\r' || char === '\n') {
          stdout.write('\n'); cleanup(); resolve(input); return;
        }
        if (char === '\x7f' || char === '\b') {
          if (input.length) { input = input.slice(0, -1); stdout.write('\b \b'); }
        } else { input += char; stdout.write('*'); }
      }
    };
    let input = '';
    stdout.write(query);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdin.once('end', onEnd);
  });
}

const DEFAULT_CONFIG_YAML = `llm:
  provider: openai
  model: gpt-4o
  maxTokens: 4096
  temperature: 0.1

agent:
  maxTurns: 50
  timeout: 300000

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
`;

const DEFAULT_GUARDRAILS_YAML = `rules:
  - name: no-destructive-commands
    pattern: "rm -rf|rm -r|del /f|format"
    severity: critical
    action: block
    type: command
  - name: no-env-file-access
    pattern: "\\\\.env"
    severity: high
    action: block
    type: file
  - name: no-system-directory-write
    pattern: "^/(etc|sys|proc|dev)/"
    severity: high
    action: block
    type: file
  - name: no-package-lock-write
    pattern: "package-lock\\\\.json"
    severity: medium
    action: approve
    type: file
  - name: no-git-config-write
    pattern: "\\\\.git/config"
    severity: critical
    action: block
    type: file
`;

const program = new Command();

program
  .name('harness')
  .description('Coding Agent Harness - CLI coding agent for autonomous development')
  .version('1.1.0');

interface HarnessSetup {
  config: AgentConfig;
  rules: GuardrailRule[];
  registry: ReturnType<typeof createToolRegistry>;
  pipeline: ReturnType<typeof createGovernancePipeline>;
  hitl: ReturnType<typeof createHITL>;
  audit: ReturnType<typeof createAuditLogger>;
  watcher: ReturnType<typeof createGuardrailWatcher>;
  credManager: ReturnType<typeof createCredentialManager>;
}

async function setupHarness(configPath: string, workspace: string): Promise<HarnessSetup> {
  console.log('Loading config...');
  workspace = resolve(workspace);
  const config = loadConfig(isAbsolute(configPath) ? configPath : resolve(workspace, configPath));
  validateConfig(config);
  console.log(`LLM Provider: ${config.llm.provider}, Model: ${config.llm.model}`);

  console.log('Registering tools...');
  const registry = createToolRegistry();
  for (const tool of createWorkspaceTools(config, workspace)) registry.register(tool);
  console.log(`Registered ${registry.list().length} tools`);

  console.log('Loading guardrail rules...');
  const rulesPath = join(workspace, config.governance.rulesFile);
  if (!existsSync(rulesPath)) throw new Error('缺少护栏文件，请先运行 harness init');
  const rules = loadGuardrailRules(rulesPath);
  console.log(`Loaded ${rules.length} guardrail rules`);

  const guardrail = createGuardrailEngine(rules);
  const watcher = createGuardrailWatcher(rulesPath, guardrail);


  const hitl = createHITL();
  const sandbox = createSandbox(
    config.governance.sandbox.allowedPaths,
    config.governance.sandbox.allowedCommands,
    workspace,
  );
  const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

  const audit = createAuditLogger(join(workspace, '.harness/audit.log'));

  const credManager = createCredentialManager(
    join(workspace, '.harness/credentials'),
    process.env.HARNESS_MASTER_PASSWORD,
  );
  const credStatus = await credManager.status();
  console.log(`Credentials: ${credStatus[config.llm.provider] ? 'configured' : 'not configured'}`);

  return { config, rules, registry, pipeline, hitl, audit, watcher, credManager };
}

async function resolveLLM(
  config: AgentConfig,
  credManager: ReturnType<typeof createCredentialManager>,
  opts: { mock: boolean; mockResponses: LLMResponse[] },
): Promise<ReturnType<typeof createLLMProvider>> {
  if (opts.mock) {
    console.log('Using mock LLM provider');
    return createMockLLM(opts.mockResponses);
  }

  console.log(`Connecting to ${config.llm.provider}...`);
  try {
    return await createLLMProvider(config.llm, credManager);
  } catch (error) {
    const provider = config.llm.provider;
    console.error(`\n无法连接 ${provider}：${(error as Error).message}`);
    console.error(`请先配置 API Key：harness key set ${provider}`);
    console.error('或设置环境变量 OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY。');
    throw error;
  }
}

interface RunOptions {
  config: string;
  workspace: string;
  mock?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  execution?: string;
  verify?: string;
}

async function performRun(task: string, options: RunOptions, previous?: StoredSession): Promise<void> {
  const workspace = resolve(options.workspace);
  const services = await setupHarness(options.config, workspace);
  const { config, rules, pipeline, hitl, audit, watcher, credManager } = services;
  if (options.execution) config.execution = { ...config.execution, mode: options.execution as 'local' | 'docker' };
  validateConfig(config);
  const tools = createWorkspaceTools(config, workspace);
  const verifier = options.verify ?? previous?.verifier;
  if (previous && options.verify !== undefined && options.verify !== previous.verifier) throw new Error('恢复时不能改变验收命令');
  const configHash = sessionConfigHash(config, rules);
  if (previous) assertSessionUnchanged(previous, workspace, configHash);
  const runId = previous?.runId ?? randomUUID();
  const tracePath = join(workspace, '.harness', 'runs', runId + '.jsonl');
  const trace = createRunTrace(tracePath, runId);
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('用户中断任务'));
  process.once('SIGINT', interrupt);
  const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
  const executor = createCommandExecutor({ workspaceRoot: workspace, mode: config.execution?.mode ?? 'docker', dockerImage: config.execution?.image, timeoutMs: config.execution?.timeout });
  try {
    const llm = await resolveLLM(config, credManager, {
      mock: !!options.mock,
      mockResponses: [{ content: '{"done":true,"summary":"离线模式仅验证执行管道，不代表真实编码能力"}' }],
    });
    watcher.start();
    const agent = createAgentLoop(config, traceProvider(llm, trace), tools, {
      onAction: async (action, turn, context) => {
        let decision = pipeline.process(action);
        trace.event('policy', { turn, action, decision });
        if (options.dryRun) return { allowed: false, reason: 'dry-run：跳过执行' };
        let approvalResult: 'approved' | 'rejected' | undefined;
        if (decision.requiresApproval) {
          if (!process.stdin.isTTY) decision = { ...decision, allowed: false, reason: '非交互模式不能审批动作' };
          else {
            const answer = await rl.question('批准 ' + action.type + ' ' + JSON.stringify(action.params) + '？(y/N) ', { signal: context?.signal });
            approvalResult = /^y(?:es)?$/i.test(answer.trim()) ? 'approved' : 'rejected';
            if (approvalResult === 'approved') hitl.approve();
            else hitl.reject('用户拒绝审批');
            decision = approvalResult === 'approved' ? pipeline.process(action, true) : { ...decision, allowed: false, reason: '用户拒绝审批' };
            trace.event('approval', { turn, action, approvalResult, decision });
          }
        }
        audit.log({ timestamp: Date.now(), action, result: decision, approvalResult });
        console.log('[' + turn + '] ' + action.type + '：' + (decision.allowed ? '执行' : decision.reason));
        return { allowed: decision.allowed, reason: decision.reason };
      },
      onTurn: (turn) => {
        trace.event('tool_result', turn);
        if (turn.result?.error) console.log('  ' + turn.result.error);
        if (options.verbose && turn.result?.output) console.log(turn.result.output);
      },
      onMessage: (messages) => { if (options.verbose) console.log(JSON.stringify(messages, null, 2)); },
      onCheckpoint: (checkpoint) => { saveSession(workspace, configHash, checkpoint, runId, verifier); },
      onVerify: verifier && !options.dryRun ? async ({ signal }) => {
        const decision = pipeline.process({ type: 'run_test', params: { command: verifier } });
        const result = decision.allowed ? await executor.execute(verifier, { signal }) : { success: false, output: '', error: decision.reason || '验收命令被策略拒绝' };
        trace.event('verification', { command: verifier, result });
        return result;
      } : undefined,
    });
    trace.event(previous ? 'resumed' : 'started', { task, model: config.llm.model, provider: options.mock ? 'mock' : config.llm.provider, execution: config.execution, verifier, configHash });
    console.log('会话：' + runId + '；执行模式：' + (config.execution?.mode ?? 'docker'));
    const result = await agent.run(task, { checkpoint: previous?.checkpoint, signal: controller.signal });
    trace.event('finished', { state: result.state, verified: result.verified, stopReason: result.stopReason, turns: result.turns, usage: result.usage, usageEstimated: result.usageEstimated });
    console.log('状态：' + result.state + '；验收：' + (result.verified ? '通过' : '未通过或未配置') + '；停止原因：' + result.stopReason);
    console.log('模型调用：' + result.turns + '；Token：' + result.usage.totalTokens + (result.usageEstimated ? '（含估算）' : ''));
    console.log('摘要：' + result.summary + '\n轨迹：' + tracePath);
    if (result.state !== 'completed' || (verifier && !result.verified)) process.exitCode = 1;
  } catch (error) {
    trace.event('error', { message: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    watcher.stop();
    rl.close();
    process.removeListener('SIGINT', interrupt);
  }
}

program.command('run <task>')
  .description('执行编码任务并保存会话检查点')
  .option('-c, --config <path>', '配置路径，相对工作区', '.harness/config.yaml')
  .option('-w, --workspace <path>', '工作区根路径', process.cwd())
  .option('-m, --mock', '离线机制自检')
  .option('-v, --verbose', '显示模型消息与工具输出')
  .option('--dry-run', '只显示计划动作')
  .option('--execution <mode>', 'docker 或显式 local')
  .option('--verify <command>', '任务完成前必须通过的验证命令')
  .action((task: string, options: RunOptions) => performRun(task, options));

program
  .command('chat', { isDefault: true })
  .description('进入交互式对话模式')
  .option('-c, --config <path>', 'Config file path', '.harness/config.yaml')
  .option('-w, --workspace <path>', 'Workspace root path', process.cwd())
  .option('-m, --mock', 'Use mock LLM provider instead of real API')
  .option('-v, --verbose', 'Print full prompt and response')
  .action(async (options: { config: string; workspace: string; mock: boolean; verbose: boolean }) => {
    const verbose = options.verbose;
    const { config, registry, pipeline, hitl, audit, watcher, credManager } = await setupHarness(options.config, options.workspace);

    const llm = await resolveLLM(config, credManager, {
      mock: options.mock,
      mockResponses: [
        { content: 'Hello! I am a mock assistant in chat mode. (mock responses are limited)' },
      ],
    });

    const rl = readlinePromises.createInterface({ input: process.stdin, output: process.stdout });
    const controller = new AbortController();
    const interrupt = () => { controller.abort(new Error('用户中断会话')); rl.close(); };
    process.once('SIGINT', interrupt);
    rl.on('SIGINT', interrupt);
    rl.on('close', () => { controller.abort(new Error('会话输入已关闭')); watcher.stop(); });
    const runId = randomUUID();
    const trace = createRunTrace(join(resolve(options.workspace), '.harness', 'runs', runId + '.jsonl'), runId);

    watcher.start();
    const chat = createChatLoop(config, traceProvider(llm, trace), registry.list(), {
      onAction: async (action, turn, context) => {
        let decision = pipeline.process(action);
        trace.event('policy', { turn, action, decision });
        let approvalResult: 'approved' | 'rejected' | undefined;
        if (decision.requiresApproval) {
          if (!process.stdin.isTTY) decision = { ...decision, allowed: false, reason: '非交互模式不能审批动作' };
          else {
            const answer = await rl.question('批准 ' + action.type + ' ' + JSON.stringify(action.params) + '？(y/N) ', { signal: context?.signal });
            approvalResult = /^y(?:es)?$/i.test(answer.trim()) ? 'approved' : 'rejected';
            if (approvalResult === 'approved') hitl.approve();
            else hitl.reject('用户拒绝审批');
            decision = approvalResult === 'approved' ? pipeline.process(action, true) : { ...decision, allowed: false, reason: '用户拒绝审批' };
            trace.event('approval', { turn, action, approvalResult, decision });
          }
        }
        audit.log({ timestamp: Date.now(), action, result: decision, approvalResult });
        console.log('  ' + action.type + '：' + (decision.allowed ? '执行' : decision.reason));
        return { allowed: decision.allowed, reason: decision.reason };
      },
      onTurn: (turn) => { trace.event('tool_result', turn); },
      onMessage: (messages: Array<{ role: string; content: string }>) => {
        if (verbose) {
          console.log('\n--- Messages sent to LLM ---');
          for (const msg of messages) {
            console.log(`[${msg.role}]: ${msg.content}`);
          }
          console.log('--- End of messages ---\n');
        }
      },
    });

    console.log('\nEntering chat mode. Type "exit" to quit.\n');

    try {
      while (true) {
        const input = (await rl.question('> ', { signal: controller.signal })).trim();
        if (!input) continue;
        if (['exit', 'quit', 'q'].includes(input.toLowerCase())) break;

        const reply = await chat.send(input, { signal: controller.signal });
        console.log(`\n${reply}\n`);
      }
    } catch (error) {
      trace.event('error', { message: error instanceof Error ? error.message : String(error) });
      if (!controller.signal.aborted) throw error;
    } finally {
      process.removeListener('SIGINT', interrupt);
      rl.close();
      watcher.stop();
    }

    console.log('Goodbye!');
  });

program.command('web').description('启动本地 Agent 工作台')
  .option('-w, --workspace <path>', '工作区目录', process.cwd())
  .option('-p, --port <number>', '本地服务端口', '4173')
  .action(async (options: { workspace: string; port: string }) => {
    const port = Number(options.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535 的整数');
    const app = await startWebServer({ workspace: resolve(options.workspace), port });
    console.log('本地工作台：' + app.url + '\n工作区：' + resolve(options.workspace));
    const stop = async () => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
      await app.close();
    };
    const interrupt = () => { void stop().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }); };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
  });

program
  .command('key <action> [provider]')
  .description('Manage API keys')
  .action(async (action: string, provider: string) => {
    const credManager = createCredentialManager(
      join(process.cwd(), '.harness/credentials'),
      process.env.HARNESS_MASTER_PASSWORD,
    );
    const validProviders = ['openai', 'anthropic', 'gemini'];

    switch (action) {
      case 'status': {
        const status = await credManager.status();
        console.log('API Key Status:');
        for (const p of validProviders) {
          console.log(`  ${p}: ${status[p] ? 'configured' : 'not configured'}`);
        }
        break;
      }
      case 'set': {
        if (!provider || !validProviders.includes(provider)) {
          console.error('Please specify a valid provider: openai, anthropic, or gemini');
          process.exit(1);
        }
        const key = await hiddenPrompt(`Enter API key for ${provider}: `);
        if (!key) {
          console.error('API key cannot be empty.');
          process.exit(1);
        }
        const confirm = await hiddenPrompt(`Confirm API key for ${provider}: `);
        if (key !== confirm) {
          console.error('Keys do not match. Please try again.');
          process.exit(1);
        }
        await credManager.set(provider, key);
        console.log(`API key for ${provider} saved.`);
        break;
      }
      case 'clear': {
        if (!provider || !validProviders.includes(provider)) {
          console.error('Please specify a valid provider: openai, anthropic, or gemini');
          process.exit(1);
        }
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Are you sure you want to clear the API key for ${provider}? (y/N): `, (a: string) => {
            resolve(a.trim().toLowerCase());
          });
        });
        rl.close();
        if (answer === 'y' || answer === 'yes') {
          await credManager.clear(provider);
          console.log(`API key for ${provider} cleared.`);
        } else {
          console.log('Cancelled.');
        }
        break;
      }
      default:
        console.error('Invalid action. Use: set, status, or clear');
        process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize a new harness project')
  .option('-w, --workspace <path>', 'Workspace path', process.cwd())
  .action(async (options: { workspace: string }) => {
    const workspace = options.workspace;
    const harnessDir = join(workspace, '.harness');

    if (!existsSync(harnessDir)) {
      mkdirSync(harnessDir, { recursive: true });
    }

    const configPath = join(harnessDir, 'config.yaml');
    if (!existsSync(configPath)) {
      writeFileSync(configPath, DEFAULT_CONFIG_YAML, 'utf-8');
      console.log('Created .harness/config.yaml');
    } else {
      console.log('.harness/config.yaml already exists, skipping');
    }

    const guardrailsPath = join(harnessDir, 'guardrails.yaml');
    if (!existsSync(guardrailsPath)) {
      writeFileSync(guardrailsPath, DEFAULT_GUARDRAILS_YAML, 'utf-8');
      console.log('Created .harness/guardrails.yaml');
    } else {
      console.log('.harness/guardrails.yaml already exists, skipping');
    }

    const credDir = join(harnessDir, 'credentials');
    if (!existsSync(credDir)) {
      mkdirSync(credDir, { recursive: true });
    }

    console.log('Harness project initialized successfully!');
    console.log('Next steps:');
    console.log('  1. harness key set <provider>  - Configure API keys');
    console.log('  2. harness run "your task"      - Start coding');
  });

program.command('session').description('会话管理')
  .command('resume [id]').description('恢复指定或最近会话')
  .option('-c, --config <path>', '配置路径，相对工作区', '.harness/config.yaml')
  .option('-w, --workspace <path>', '工作区目录', process.cwd())
  .option('-m, --mock', '离线机制自检')
  .option('-v, --verbose', '显示模型消息与工具输出')
  .option('--execution <mode>', 'docker 或显式 local')
  .option('--verify <command>', '必须与原验收命令一致')
  .action(async (id: string | undefined, options: RunOptions) => {
    const previous = loadSession(resolve(options.workspace), id);
    await performRun(previous.checkpoint.task, options, previous);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
