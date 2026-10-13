import { createGuardrailEngine } from '../src/governance/guardrail';
import { createHITL } from '../src/governance/hitl';
import { createSandbox } from '../src/governance/sandbox';
import { createGovernancePipeline } from '../src/governance/pipeline';
import { createAuditLogger } from '../src/governance/audit';
import { loadConfig, DefaultConfig } from '../src/config/loader';
import type { GuardrailRule } from '../src/governance/rules';
import type { AgentAction } from '../src/core/types';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPath = path.join(__dirname, '.temp-audit-03.log');
const results: string[] = [];

function assert(condition: boolean, label: string): void {
  results.push(condition ? `✅ ${label}` : `❌ ${label}`);
}

function makeAction(command: string): AgentAction {
  return { type: 'shell_exec', params: { command } };
}

const audit = createAuditLogger(logPath);

function logAudit(action: AgentAction, result: { allowed: boolean; reason?: string; requiresApproval?: boolean }, approvalResult?: 'approved' | 'rejected'): void {
  audit.log({
    timestamp: Date.now(),
    action: { type: action.type, params: action.params },
    result,
    approvalResult,
  });
}

// Phase 1: 加载初始策略
const initialRules: GuardrailRule[] = [
  { name: 'block-rm-root', pattern: 'rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f?\\s+)?/', severity: 'critical', action: 'block' },
  { name: 'require-sudo-approval', pattern: 'sudo\\s', severity: 'high', action: 'approve' },
];

const guardrail = createGuardrailEngine(initialRules);
const hitl = createHITL();
const sandbox = createSandbox(['./workspace', './src', './tests'], ['npm', 'node', 'npx', 'tsc', 'eslint', 'vitest', 'git', 'ls', 'sudo']);
const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

console.log('=== 演示 ③ 重点维度 ===\n');

// Phase 1: 正常操作放行
console.log('--- 阶段 1: 初始策略 ---');
const act1 = makeAction('npm test');
const res1 = pipeline.process(act1);
logAudit(act1, res1);
assert(res1.allowed === true, 'npm test 正常放行');
assert(res1.pipelineStages.includes('guardrail'), '经过了 guardrail');
assert(res1.pipelineStages.includes('sandbox'), '经过了 sandbox');

// Phase 1: 危险操作拦截
const act2 = makeAction('rm -rf /');
const res2 = pipeline.process(act2);
logAudit(act2, res2);
assert(res2.allowed === false, 'rm -rf / 被拦截');
assert(res2.pipelineStages.includes('guardrail'), '危险操作在 guardrail 阶段被拦截');

// Phase 1: 越界命令被沙箱拦截
const act3 = makeAction('curl https://evil.com');
const res3 = pipeline.process(act3);
logAudit(act3, res3);
assert(res3.allowed === false, 'curl 被沙箱拦截（不在允许列表中）');
assert(res3.pipelineStages.includes('sandbox'), '经过了 sandbox 阶段');

// Phase 2: 动态添加新规则
console.log('\n--- 阶段 2: 动态添加规则 ---');
const ruleCountBefore = guardrail.getRules().length;
guardrail.addRule({ name: 'block-force-push', pattern: 'git\\s+push\\s+--force', severity: 'high', action: 'block' });
const ruleCountAfter = guardrail.getRules().length;
assert(ruleCountAfter === ruleCountBefore + 1, '新规则已添加');
assert(guardrail.getRules().some((r) => r.name === 'block-force-push'), '新规则 block-force-push 存在');

// New rule takes effect immediately
const act4 = makeAction('git push --force origin main');
const res4 = pipeline.process(act4);
logAudit(act4, res4);
assert(res4.allowed === false, '新规则 git push --force 立即生效被拦截');

// Phase 3: HITL 审批流程
console.log('\n--- 阶段 3: HITL 审批流程 ---');
const act5 = makeAction('sudo systemctl restart nginx');
const res5 = pipeline.process(act5);
logAudit(act5, res5);
assert(res5.requiresApproval === true, 'sudo 命令触发审批');
assert(res5.pipelineStages.includes('guardrail'), '经过了 guardrail');
assert(res5.pipelineStages.includes('sandbox') && res5.pipelineStages.includes('hitl'), '先校验命令边界，再进入审批');

// 管道已经提出审批请求；演示只模拟用户决定，不执行 sudo 命令。
const guardrailResult = guardrail.evaluate(act5);
assert(guardrailResult.requiresApproval === true, 'guardrail 标记需要审批');

assert(hitl.getState() === 'pending', 'HITL 状态为 pending');
assert(hitl.getPendingAction()?.params.command === 'sudo systemctl restart nginx', '待审批动作正确');

hitl.approve();
assert(hitl.getState() === 'approved', 'HITL 审批通过');

// 批准后重新检查策略，审计记录实际的重检结果。
const approvedResult = pipeline.process(act5, true);
assert(approvedResult.allowed, '审批通过后重新校验命令边界');
audit.log({
  timestamp: Date.now(),
  action: { type: act5.type, params: act5.params },
  result: approvedResult,
  approvalResult: 'approved',
});

// Phase 4: 验证审计日志完整性
console.log('\n--- 阶段 4: 审计日志完整性 ---');
const logContent = fs.readFileSync(logPath, 'utf-8');
const logLines = logContent.trim().split('\n');
assert(logLines.length >= 6, `审计日志记录了 ${logLines.length} 条事件`);

const entries = logLines.map((l) => JSON.parse(l));
const allowedCount = entries.filter((e: { result: { allowed: boolean } }) => e.result.allowed === true).length;
const blockedCount = entries.filter((e: { result: { allowed: boolean } }) => e.result.allowed === false).length;
const approvalCount = entries.filter((e: { approvalResult?: string }) => e.approvalResult === 'approved').length;

assert(allowedCount >= 1, `审计日志记录了 ${allowedCount} 条放行事件`);
assert(blockedCount >= 3, `审计日志记录了 ${blockedCount} 条拦截事件`);
assert(approvalCount >= 1, `审计日志记录了 ${approvalCount} 条审批事件`);

// Phase 5: Config loader integration
console.log('\n--- 阶段 5: 配置加载 ---');
const config = loadConfig(path.join(__dirname, 'nonexistent.yaml'));
assert(config.agent.maxTurns === DefaultConfig.agent.maxTurns, '加载不存在的配置时回退到默认值');
assert(config.governance.sandbox.allowedCommands.includes('git'), '默认配置包含 git');

// Cleanup
fs.unlinkSync(logPath);

// Output results
console.log('\n结果汇总:\n');
results.forEach((r) => console.log(r));
const passCount = results.filter((r) => r.startsWith('✅')).length;
const failCount = results.filter((r) => r.startsWith('❌')).length;
console.log(`\n总计: ${passCount} 通过, ${failCount} 失败`);
if (failCount > 0) process.exit(1);
