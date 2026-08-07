import { createMockLLM } from '../src/llm/mock';
import { createAgentLoop } from '../src/core/loop';
import { createToolRegistry } from '../src/tools/registry';
import { createFeedbackRunner } from '../src/feedback/runner';
import { createFeedbackInjector } from '../src/feedback/injector';
import { parseTestOutput } from '../src/feedback/parser';
import type { AgentConfig, ToolDefinition, LLMResponse, AgentAction } from '../src/core/types';

const results: string[] = [];

function assert(condition: boolean, label: string): void {
  results.push(condition ? `✅ ${label}` : `❌ ${label}`);
}

async function main(): Promise<void> {
  const feedbackRunner = createFeedbackRunner();
  const feedbackInjector = createFeedbackInjector();

  // Simulated test output with failures
  const fakeTestOutput = `FAIL src/test.ts:10:1 - expected 1 to equal 2
1 tests failed, 0 passed`;

  // Parse the simulated test output
  const parsedSignal = parseTestOutput(fakeTestOutput);
  assert(parsedSignal.passed === false, '解析器正确识别测试失败');
  assert(parsedSignal.type === 'test', '信号类型为 test');
  assert(parsedSignal.summary.includes('failed'), '摘要包含失败信息');

  // Inject feedback using format
  const formatted = feedbackInjector.format(parsedSignal);
  assert(formatted.role === 'feedback', '反馈角色为 feedback');
  assert(formatted.content.includes('FAILED'), '反馈内容包含 FAILED');
  assert(formatted.content.includes('[TEST]'), '反馈内容包含类型标签');

  // Build MockLLM with 2-turn responses
  const mockResponses: LLMResponse[] = [
    { content: '```json\n{"action": {"type": "shell_exec", "params": {"command": "echo hello"}}}\n```' },
    { content: '```json\n{"done": true, "summary": "任务完成"}\n```' },
  ];

  const mockLLM = createMockLLM(mockResponses);

  // Create shell_exec tool
  const shellExecTool: ToolDefinition = {
    name: 'shell_exec',
    description: 'Execute a shell command',
    parameters: {
      command: { type: 'string', description: 'The command to execute', required: true },
    },
    execute: async (params: Record<string, string>) => {
      return { success: true, output: `executed: ${params.command}` };
    },
  };

  const registry = createToolRegistry();
  registry.register(shellExecTool);

  const config: AgentConfig = {
    llm: { provider: 'openai', model: 'gpt-4o', maxTokens: 4096, temperature: 0.1 },
    agent: { maxTurns: 5, timeout: 300000 },
    governance: { rulesFile: '', sandbox: { allowedPaths: [], allowedCommands: [] } },
    memory: { storagePath: '', maxConversationTurns: 20 },
  };

  const feedbackMessages: string[] = [];

  const loop = createAgentLoop(config, mockLLM, registry.list(), {
    onAction(action: AgentAction, _turn: number) {
      feedbackMessages.push(`Feedback: ${action.type} executed`);
      return undefined;
    },
    onTurn(turn) {
      if (turn.result && turn.result.output) {
        // Simulate feedback loop: run test after action, parse, inject
        const testSignal = parseTestOutput(fakeTestOutput);
        const formatted = feedbackInjector.format(testSignal);
        feedbackMessages.push(formatted.content);
      }
    },
    onStop(reason: string) {
      feedbackMessages.push(`Stop: ${reason}`);
    },
  });

  const runResult = await loop.run('Run echo and then indicate done');

  // Assertions
  assert(runResult.turns === 2, '执行了 2 轮对话');
  assert(runResult.state === 'completed', 'Agent 正常完成');
  assert(runResult.summary === '任务完成', '摘要正确');
  assert(feedbackMessages.length >= 2, '反馈消息已生成');

  // Verify feedback was injected after first action
  const hasFeedback = feedbackMessages.some((m) => m.includes('[TEST]') && m.includes('FAILED'));
  assert(hasFeedback, '反馈被正确生成和注入');

  console.log('\n=== 演示 ② 反馈闭环 ===\n');
  results.forEach((r) => console.log(r));
  const passCount = results.filter((r) => r.startsWith('✅')).length;
  const failCount = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n结果: ${passCount} 通过, ${failCount} 失败`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error('演示 ② 异常:', err);
  process.exit(1);
});