import { createAgentLoop } from '../src/core/loop';
import { createMockLLM } from '../src/llm/mock';
import type {
  AgentConfig,
  ActionResult,
  ToolDefinition,
} from '../src/core/types';

/**
 * 演示 ② 反馈闭环（A.6 要求）
 *
 * 注入一次测试失败 → harness 将失败结果回灌给 LLM → agent 据此改变下一步动作（从「跑测试」改为「写文件修复」）。
 *
 * 全程使用 mock LLM + 确定性工具，无网络、无真实 shell、无文件落盘依赖。
 * 这里演示的是「反馈回灌」这一 harness 机制本身：移除真实 LLM 后，仍能断言
 * 失败结果被写进下一轮上下文，且 agent 的后续动作因此改变。
 */

const results: string[] = [];
function assert(condition: boolean, label: string): void {
  results.push(condition ? `✅ ${label}` : `❌ ${label}`);
}

// —— 确定性工具：一个必然失败的测试工具，用于「注入失败」 ——
const failingTestTool: ToolDefinition = {
  name: 'run_test',
  description: '执行测试命令并返回结果',
  parameters: {
    command: { type: 'string', description: '要执行的测试命令', required: true },
  },
  execute: async (): Promise<ActionResult> => ({
    success: false,
    output: '1 failed, 0 passed',
    error: 'AssertionError: expected 2 to equal 3',
    exitCode: 1,
  }),
};

// —— 记录修复动作的工具，用于断言 agent 确实「改变了动作」 ——
let writtenParams: Record<string, string> | null = null;
const recordingWriteTool: ToolDefinition = {
  name: 'write_file',
  description: '写入文件',
  parameters: {
    path: { type: 'string', description: '文件路径', required: true },
    content: { type: 'string', description: '文件内容', required: true },
  },
  execute: async (params: Record<string, string>): Promise<ActionResult> => {
    writtenParams = params;
    return { success: true, output: `written ${params.path}` };
  },
};

const tools = [failingTestTool, recordingWriteTool];

const config: AgentConfig = {
  llm: { provider: 'openai', model: 'mock', maxTokens: 1000, temperature: 0 },
  agent: { maxTurns: 10, timeout: 5000 },
  governance: {
    rulesFile: '',
    sandbox: { allowedPaths: ['./'], allowedCommands: [] },
  },
  memory: { storagePath: '', maxConversationTurns: 20 },
};

// —— mock LLM：三轮预设响应，模拟「先跑测试 → 收到失败后改为修复 → 完成」 ——
const mock = createMockLLM([
  { content: '{"action":{"type":"run_test","params":{"command":"npm test"}}}' },
  { content: '{"action":{"type":"write_file","params":{"path":"src/fix.ts","content":"const answer = 3;"}}}' },
  { content: '{"done":true,"summary":"fixed the failing assertion"}' },
]);

// —— 捕获每轮发给 LLM 的消息快照，用于断言「失败结果确实被回灌」 ——
const messageSnapshots: Array<Array<{ role: string; content: string }>> = [];
const loop = createAgentLoop(config, mock, tools, {
  onMessage: (messages) => messageSnapshots.push([...messages]),
});

async function main(): Promise<void> {
  console.log('=== 演示 ② 反馈闭环 ===\n');

  const result = await loop.run('修复失败的测试');

  // 1. 第一轮执行 run_test，注入的失败结果应被捕获
  assert(
    result.history[1]?.action?.type === 'run_test',
    '第一轮执行 run_test',
  );
  assert(
    result.history[1]?.result?.success === false,
    '注入的测试失败被捕获（success=false）',
  );
  assert(
    result.history[1]?.result?.error?.includes('AssertionError'),
    '失败原因（AssertionError）被记录',
  );

  // 2. 失败结果被回灌到下一轮 LLM 的上下文
  const secondRound = messageSnapshots[1] ?? [];
  const feedbackMessage = secondRound.find(
    (m) => m.role === 'user' && m.content.includes('Action result'),
  );
  assert(feedbackMessage !== undefined, '失败结果作为「Action result」回灌到下一轮上下文');
  assert(
    feedbackMessage?.content.includes('"success":false') ?? false,
    '回灌内容包含 success=false',
  );

  // 3. agent 收到失败反馈后改变了下一步动作：从 run_test 改为 write_file（修复）
  assert(
    result.history[2]?.action?.type === 'write_file',
    'agent 收到失败后从「跑测试」改为「写文件修复」',
  );
  assert(
    writtenParams?.path === 'src/fix.ts' && writtenParams?.content === 'const answer = 3;',
    '修复动作写入了正确的文件与内容',
  );

  // 4. 修复完成后正常停机
  assert(result.state === 'completed', 'agent 在修复后正常完成（done）');
  assert(
    result.summary === 'fixed the failing assertion',
    '完成摘要正确',
  );

  console.log('\n结果汇总:\n');
  results.forEach((r) => console.log(r));
  const passCount = results.filter((r) => r.startsWith('✅')).length;
  const failCount = results.filter((r) => r.startsWith('❌')).length;
  console.log(`\n总计: ${passCount} 通过, ${failCount} 失败`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
