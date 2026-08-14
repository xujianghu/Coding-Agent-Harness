#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { createToolRegistry } from '../tools/registry';
import { createReadFileTool, createWriteFileTool } from '../tools/file';
import { createShellTool } from '../tools/shell';
import { createTestRunnerTool } from '../tools/test-runner';
import { createLintTool } from '../tools/lint';
import { createGuardrailEngine } from '../governance/guardrail';
import { createGuardrailWatcher } from '../governance/watcher';
import { createHITL } from '../governance/hitl';
import { createSandbox } from '../governance/sandbox';
import { createGovernancePipeline } from '../governance/pipeline';
import { createAuditLogger } from '../governance/audit';
import { GuardrailRule } from '../governance/rules';
import { createMemoryStore } from '../memory/store';
import { createMemoryRetriever } from '../memory/retriever';
import { createMockLLM } from '../llm/mock';
import { createLLMProvider } from '../llm/factory';
import { createAgentLoop } from '../core/loop';
import { createCredentialManager } from '../credential/manager';
import { AgentAction, ConversationTurn } from '../core/types';
import { parse } from 'yaml';
import * as readline from 'readline';
import { parseSessionState } from './session';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

function hiddenPrompt(query: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(query);
    stdin.setRawMode(true);
    stdin.resume();
    let input = '';
    stdin.on('data', (chunk: Buffer) => {
      const char = chunk.toString();
      if (char === '\r' || char === '\n') {
        stdout.write('\n');
        stdin.setRawMode(false);
        stdin.pause();
        resolve(input);
      } else if (char === '\x7f') {
        input = input.slice(0, -1);
        stdout.write('\b \b');
      } else {
        input += char;
        stdout.write('*');
      }
    });
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
      - ./workspace
      - ./src
      - ./tests
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
  .version('1.0.0');

program
  .command('run <task>')
  .description('Execute a coding task')
  .option('-c, --config <path>', 'Config file path', '.harness/config.yaml')
  .option('-w, --workspace <path>', 'Workspace root path', process.cwd())
  .option('-m, --mock', 'Use mock LLM provider instead of real API')
  .option('-v, --verbose', 'Print full prompt and response')
  .option('--dry-run', 'Plan actions without executing them')
  .action(async (task: string, options: { config: string; workspace: string; mock: boolean; verbose: boolean; dryRun: boolean }) => {
    const configPath = options.config;
    const workspace = options.workspace;
    const verbose = options.verbose;
    const dryRun = options.dryRun;

    console.log('Loading config...');
    const config = loadConfig(configPath);
    console.log(`LLM Provider: ${config.llm.provider}, Model: ${config.llm.model}`);

    console.log('Registering tools...');
    const registry = createToolRegistry();
    registry.register(createReadFileTool(workspace));
    registry.register(createWriteFileTool(workspace));
    registry.register(createShellTool());
    registry.register(createTestRunnerTool());
    registry.register(createLintTool());
    console.log(`Registered ${registry.list().length} tools`);

    console.log('Loading guardrail rules...');
    let rules: GuardrailRule[] = [];
    const rulesPath = join(workspace, config.governance.rulesFile);
    if (existsSync(rulesPath)) {
      const rulesContent = readFileSync(rulesPath, 'utf-8');
      const parsed = parse(rulesContent);
      if (parsed && typeof parsed === 'object' && 'rules' in parsed) {
        rules = (parsed as { rules: GuardrailRule[] }).rules;
      }
    }
    console.log(`Loaded ${rules.length} guardrail rules`);

    const guardrail = createGuardrailEngine(rules);
    const guardrailWatcher = createGuardrailWatcher(rulesPath, guardrail);
    guardrailWatcher.start();

    const hitl = createHITL();
    const sandbox = createSandbox(
      config.governance.sandbox.allowedPaths,
      config.governance.sandbox.allowedCommands,
    );
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const audit = createAuditLogger(join(workspace, '.harness/audit.log'));

    const credManager = createCredentialManager(
      join(workspace, '.harness/credentials'),
      process.env.HARNESS_MASTER_PASSWORD,
    );
    const credStatus = await credManager.status();
    console.log(`Credentials: ${credStatus[config.llm.provider] ? 'configured' : 'not configured'}`);

    let llm;
    if (options.mock) {
      console.log('Using mock LLM provider');
      llm = createMockLLM([
        {
          content: `\`\`\`json\n{"action": {"type": "read_file", "params": {"path": "package.json"}}}\n\`\`\``,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        },
        {
          content: `\`\`\`json\n{"done": true, "summary": "Task completed successfully"}\n\`\`\``,
          usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
        },
      ]);
    } else {
      console.log(`Connecting to ${config.llm.provider}...`);
      llm = await createLLMProvider(config.llm, credManager);
    }

    const memoryStore = await createMemoryStore(join(workspace, config.memory.storagePath));
    const memoryRetriever = createMemoryRetriever(memoryStore);

    const agent = createAgentLoop(config, llm, registry.list(), {
      onAction: async (action: AgentAction, turn: number) => {
        if (verbose) {
          console.log(`[Turn ${turn}] Action: ${action.type}`, JSON.stringify(action.params));
        }

        if (dryRun) {
          console.log(`  Would execute: ${action.type} ${JSON.stringify(action.params)}`);
          return { allowed: false, reason: 'Dry-run mode' };
        }

        if (!verbose) {
          console.log(`[Turn ${turn}] Action: ${action.type}`, JSON.stringify(action.params));
        }
        const result = pipeline.process(action);
        audit.log({
          timestamp: Date.now(),
          action: { type: action.type, params: action.params },
          result: {
            allowed: result.allowed,
            reason: result.reason,
            requiresApproval: result.requiresApproval,
          },
        });
        if (!result.allowed) {
          if (result.requiresApproval) {
            const approved = await hitl.requestInteractiveApproval(action);
            if (approved) {
              return { allowed: true };
            }
            return { allowed: false, reason: 'User denied approval' };
          }
          console.log(`  Guardrail blocked: ${result.reason}`);
        }
        return { allowed: result.allowed, reason: result.reason };
      },
      onTurn: (turn: ConversationTurn) => {
        if (turn.result) {
          console.log(`  Result: ${turn.result.success ? 'success' : 'failed'}`);
          if (verbose && turn.result.output) {
            console.log(`  Output: ${turn.result.output}`);
          }
          if (turn.result.error) {
            console.log(`  Error: ${turn.result.error}`);
          }
        }
      },
      onStop: (reason: string) => {
        console.log(`Stop reason: ${reason}`);
      },
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

    console.log(`\nRunning task: ${task}\n`);
    try {
      const result = await agent.run(task);

      console.log(`\n=== Task Complete ===`);
      console.log(`Status: ${result.state}`);
      console.log(`Turns: ${result.turns}`);
      console.log(`Summary: ${result.summary}`);
    } catch (error) {
      console.error(`\n=== Task Failed ===`);
      console.error(`Error: ${(error as Error).message}`);
      process.exitCode = 1;
    } finally {
      // 关闭护栏文件监听，避免 fs.watch 让进程在任务结束后无法退出。
      guardrailWatcher.stop();
    }
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

program
  .command('session resume')
  .description('Resume from last session using audit log')
  .option('-w, --workspace <path>', 'Workspace path', process.cwd())
  .action(async (options: { workspace: string }) => {
    const auditPath = join(options.workspace, '.harness/audit.log');
    const sessionState = parseSessionState(auditPath);

    if (!sessionState) {
      console.log('No previous session found.');
      return;
    }

    console.log(`Resuming session: ${sessionState.summary}`);
    console.log(`Last turn: ${sessionState.lastTurn}`);
    if (sessionState.lastAction) {
      console.log(`Last action: ${sessionState.lastAction.type} ${JSON.stringify(sessionState.lastAction.params)}`);
    }
  });

program.parse();