import { createGuardrailEngine } from '../src/governance/guardrail';
import { createHITL } from '../src/governance/hitl';
import { createSandbox } from '../src/governance/sandbox';
import { createGovernancePipeline } from '../src/governance/pipeline';
import { createAuditLogger } from '../src/governance/audit';
import type { GuardrailRule } from '../src/governance/rules';
import type { AgentAction } from '../src/core/types';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPath = path.join(__dirname, '.temp-audit-01.log');
const results: string[] = [];

function assert(condition: boolean, label: string): void {
  results.push(condition ? `✅ ${label}` : `❌ ${label}`);
}

const rules: GuardrailRule[] = [
  { name: 'block-rm-root', pattern: 'rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f?\\s+)?/', severity: 'critical', action: 'block' },
  { name: 'block-force-push', pattern: 'git\\s+push\\s+--force', severity: 'high', action: 'block' },
  { name: 'require-sudo-approval', pattern: 'sudo\\s', severity: 'high', action: 'approve' },
];

const guardrail = createGuardrailEngine(rules);
const hitl = createHITL();
const sandbox = createSandbox(['./workspace', './src', './tests'], ['npm', 'node', 'npx', 'tsc', 'eslint', 'vitest', 'git', 'rm', 'sudo']);
const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);
const audit = createAuditLogger(logPath);

function makeAction(command: string): AgentAction {
  return { type: 'shell_exec', params: { command } };
}

function logAudit(action: AgentAction, result: { allowed: boolean; reason?: string; requiresApproval?: boolean }): void {
  audit.log({ timestamp: Date.now(), action: { type: action.type, params: action.params }, result });
}

// Test 1: rm -rf / should be blocked
const act1 = makeAction('rm -rf /');
const res1 = pipeline.process(act1);
logAudit(act1, res1);
assert(res1.allowed === false, 'rm -rf / 被拦截');
assert(res1.reason !== undefined, '拦截原因已记录');
assert(res1.pipelineStages.includes('guardrail'), '经过了 guardrail 阶段');

// Test 2: git push --force should be blocked
const act2 = makeAction('git push --force origin main');
const res2 = pipeline.process(act2);
logAudit(act2, res2);
assert(res2.allowed === false, 'git push --force 被拦截');
assert(res2.reason !== undefined, '拦截原因已记录');

// Test 3: npm test should be allowed
const act3 = makeAction('npm test');
const res3 = pipeline.process(act3);
logAudit(act3, res3);
assert(res3.allowed === true, 'npm test 正常放行');
assert(res3.pipelineStages.includes('guardrail'), '经过了 guardrail 阶段');
assert(res3.pipelineStages.includes('sandbox'), '经过了 sandbox 阶段');

// Test 4: Verify audit log
const logContent = fs.readFileSync(logPath, 'utf-8');
const logLines = logContent.trim().split('\n');
assert(logLines.length >= 3, `审计日志记录了 ${logLines.length} 条事件`);
const blockedCount = logLines.filter((l) => {
  const entry = JSON.parse(l);
  return entry.result.allowed === false;
}).length;
assert(blockedCount >= 2, `审计日志记录了 ${blockedCount} 条拦截事件`);

// Cleanup
fs.unlinkSync(logPath);

// Output results
console.log('\n=== 演示 ① 护栏拦截 ===\n');
results.forEach((r) => console.log(r));
const passCount = results.filter((r) => r.startsWith('✅')).length;
const failCount = results.filter((r) => r.startsWith('❌')).length;
console.log(`\n结果: ${passCount} 通过, ${failCount} 失败`);
if (failCount > 0) process.exit(1);