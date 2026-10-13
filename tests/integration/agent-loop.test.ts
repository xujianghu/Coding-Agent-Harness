import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAgentLoop } from '../../src/core/loop';
import { createMockLLM } from '../../src/llm/mock';
import { createReadFileTool, createWriteFileTool } from '../../src/tools/file';
import { createGuardrailEngine } from '../../src/governance/guardrail';
import { createGovernancePipeline } from '../../src/governance/pipeline';
import { createHITL } from '../../src/governance/hitl';
import { createSandbox } from '../../src/governance/sandbox';
import { AgentConfig, AgentAction, LLMResponse, ToolDefinition } from '../../src/core/types';
import { GuardrailRule } from '../../src/governance/rules';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    llm: { provider: 'openai', model: 'gpt-4', maxTokens: 4096, temperature: 0 },
    agent: { maxTurns: 10, timeout: 30000 },
    governance: { rulesFile: '', sandbox: { allowedPaths: [], allowedCommands: [] } },
    memory: { storagePath: '', maxConversationTurns: 100 },
    ...overrides,
  };
}

describe('Agent 集成测试：主循环 → 管道 → 工具执行 → 反馈回灌', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-integration-'));
  });

  afterEach(() => {
    if (fs.existsSync(workspaceDir)) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it('1. Agent 完成文件创建任务', async () => {
    const writeAction = { type: 'write_file', params: { path: 'hello.txt', content: 'Hello, World!' } };
    const responses: LLMResponse[] = [
      { content: JSON.stringify({ action: writeAction }) },
      { content: JSON.stringify({ done: true, summary: 'File created' }) },
    ];
    const mockLLM = createMockLLM(responses);

    const tools: ToolDefinition[] = [
      createReadFileTool(workspaceDir),
      createWriteFileTool(workspaceDir),
    ];

    const config = makeConfig({
      agent: { maxTurns: 10, timeout: 30000 },
    });

    const guardrail = createGuardrailEngine([]);
    const hitl = createHITL();
    const sandbox = createSandbox(['.'], [], workspaceDir);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const loop = createAgentLoop(config, mockLLM, tools, {
      onAction: (action) => pipeline.process(action),
    });

    const result = await loop.run('Create a hello.txt file');

    const filePath = path.join(workspaceDir, 'hello.txt');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello, World!');

    expect(result.state).toBe('completed');
    expect(result.turns).toBe(2);
    expect(result.summary).toBe('File created');

    expect(result.history.length).toBe(2);
    expect(result.history[0].role).toBe('user');
    expect(result.history[0].content).toBe('Create a hello.txt file');
    expect(result.history[1].role).toBe('assistant');
    expect(result.history[1].action?.type).toBe('write_file');
    expect(result.history[1].result?.success).toBe(true);
  });

  it('2. Agent 危险命令被护栏拦截', async () => {
    const dangerousAction = { type: 'shell_exec', params: { command: 'rm -rf /' } };
    const responses: LLMResponse[] = [
      { content: JSON.stringify({ action: dangerousAction }) },
    ];
    const mockLLM = createMockLLM(responses);

    let shellExecuted = false;
    const shellTool: ToolDefinition = {
      name: 'shell_exec',
      description: 'Execute shell command',
      parameters: { command: { type: 'string', description: 'command', required: true } },
      execute: async () => {
        shellExecuted = true;
        return { success: true, output: '' };
      },
    };

    const tools = [shellTool];
    const config = makeConfig({ agent: { maxTurns: 1, timeout: 30000 } });

    const rules: GuardrailRule[] = [
      { name: 'block-rm-rf', pattern: 'rm\\s+-rf\\s+/', severity: 'critical', action: 'block' },
    ];
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox([workspaceDir], []);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const loop = createAgentLoop(config, mockLLM, tools, {
      onAction: (action) => pipeline.process(action),
    });

    const result = await loop.run('Delete everything');

    expect(result.state).toBe('stopped');
    expect(result.turns).toBe(1);
    expect(shellExecuted).toBe(false);

    expect(result.history.length).toBe(2);
    expect(result.history[1].action?.type).toBe('shell_exec');
    expect(result.history[1].result?.success).toBe(false);
    expect(result.history[1].result?.error).toContain('Blocked');
  });

  it('3. Agent 反馈闭环', async () => {
    const failCommand = { type: 'shell_exec', params: { command: 'exit 1' } };
    const responses: LLMResponse[] = [
      { content: JSON.stringify({ action: failCommand }) },
      { content: JSON.stringify({ done: true, summary: 'acknowledged failure' }) },
    ];
    const mockLLM = createMockLLM(responses);

    const shellTool: ToolDefinition = {
      name: 'shell_exec',
      description: 'Execute shell command',
      parameters: { command: { type: 'string', description: 'command', required: true } },
      execute: async (params) => ({
        success: false,
        output: '',
        error: `command failed: ${params.command}`,
        exitCode: 1,
      }),
    };

    const tools = [shellTool];
    const config = makeConfig({ agent: { maxTurns: 10, timeout: 30000 } });

    const guardrail = createGuardrailEngine([]);
    const hitl = createHITL();
    const sandbox = createSandbox([workspaceDir], ['exit']);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const loop = createAgentLoop(config, mockLLM, tools, {
      onAction: (action) => pipeline.process(action),
    });

    const result = await loop.run('Run a failing command');

    expect(result.state).toBe('completed');
    expect(result.turns).toBe(2);

    expect(result.history.length).toBe(2);
    expect(result.history[1].action?.type).toBe('shell_exec');
    expect(result.history[1].result?.success).toBe(false);
    expect(result.history[1].result?.error).toContain('command failed');
    expect(result.history[1].result?.exitCode).toBe(1);
  });

  it('4. Agent 达到 maxTurns 后停机', async () => {
    const shellAction = { type: 'shell_exec', params: { command: 'echo hi' } };
    const responses: LLMResponse[] = [
      { content: JSON.stringify({ action: shellAction }) },
      { content: JSON.stringify({ action: shellAction }) },
      { content: JSON.stringify({ action: shellAction }) },
    ];
    const mockLLM = createMockLLM(responses);

    let executionCount = 0;
    const shellTool: ToolDefinition = {
      name: 'shell_exec',
      description: 'Execute shell command',
      parameters: { command: { type: 'string', description: 'command', required: true } },
      execute: async (params) => {
        executionCount++;
        return { success: true, output: `executed: ${params.command}` };
      },
    };

    const tools = [shellTool];
    const config = makeConfig({ agent: { maxTurns: 2, timeout: 30000 } });

    const guardrail = createGuardrailEngine([]);
    const hitl = createHITL();
    const sandbox = createSandbox([workspaceDir], ['echo']);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const loop = createAgentLoop(config, mockLLM, tools, {
      onAction: (action) => pipeline.process(action),
    });

    const result = await loop.run('Run echo repeatedly');

    expect(result.state).toBe('stopped');
    expect(result.turns).toBe(2);
    expect(executionCount).toBe(2);

    expect(result.history.length).toBe(3);
    expect(result.history[0].role).toBe('user');
    expect(result.history[1].action?.type).toBe('shell_exec');
    expect(result.history[1].result?.success).toBe(true);
    expect(result.history[2].action?.type).toBe('shell_exec');
    expect(result.history[2].result?.success).toBe(true);
  });
});
