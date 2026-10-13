import type { ActionResult, LLMMessage, LLMProvider, TokenUsage } from '../core/types';
import { estimateContextTokens, estimateTokens } from '../core/runtime';
import type { EvaluationMode } from './types';

/** 消融只移除失败诊断，保留角色、调用 ID 和失败状态，保证原生工具协议完整。 */
export function hideFailureDiagnostics(messages: LLMMessage[]): LLMMessage[] {
  return messages.map(message => {
    let content = message.content;
    if (message.role === 'tool') {
      try {
        const result = JSON.parse(content) as ActionResult;
        if (result.success === false) content = JSON.stringify({ success: false, output: '', error: '工具执行失败（消融实验移除诊断）', exitCode: result.exitCode });
      } catch {
        // 未识别的成功/普通消息保持原样，不破坏供应商协议。
      }
    } else if (message.role === 'user') {
      const start = content.indexOf('{');
      if (start >= 0) {
        try {
          const result = JSON.parse(content.slice(start)) as ActionResult;
          if (result.success === false) content = content.slice(0, start) + JSON.stringify({ success: false, output: '', error: '执行失败（消融实验移除诊断）', exitCode: result.exitCode });
        } catch {
          if (/verification failed|验收失败|验证失败/i.test(content)) content = '任务验证失败，请继续修复（消融实验移除诊断）。';
        }
      } else if (/verification failed|验收失败|验证失败/i.test(content)) content = '任务验证失败，请继续修复（消融实验移除诊断）。';
    }
    return { ...message, content };
  });
}

function addUsage(target: TokenUsage, source: TokenUsage): void {
  target.promptTokens += source.promptTokens;
  target.completionTokens += source.completionTokens;
  target.totalTokens += source.totalTokens;
}

export function wrapEvaluationProvider(provider: LLMProvider, mode: EvaluationMode, mock: boolean, onEvent?: (event: object) => void) {
  const real: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const estimated: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let realCalls = 0;
  let estimatedCalls = 0;
  let unavailableCalls = 0;
  const wrapped: LLMProvider = {
    name: provider.name,
    async complete(messages, tools, options) {
      const supplied = mode === 'no-feedback' ? hideFailureDiagnostics(messages) : messages;
      onEvent?.({ type: 'model-request', messages: supplied, options: { maxTokens: options?.maxTokens, temperature: options?.temperature } });
      let response;
      try {
        response = await provider.complete(supplied, tools, options);
      } catch (error) {
        unavailableCalls++;
        onEvent?.({ type: 'model-error', error: error instanceof Error ? error.message : String(error), usageUnavailable: true });
        throw error;
      }
      onEvent?.({ type: 'model-response', response });
      if (response.usage && !mock) { realCalls++; addUsage(real, response.usage); }
      else {
        estimatedCalls++;
        const promptTokens = estimateContextTokens(supplied, tools?.map(({ execute: _execute, ...tool }) => tool));
        const completionTokens = estimateTokens(response);
        addUsage(estimated, { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens });
      }
      return response;
    },
  };
  return { provider: wrapped, statistics: () => ({ realUsage: realCalls ? { ...real } : null, estimatedUsage: estimatedCalls ? { ...estimated } : null, usageEstimated: estimatedCalls > 0 || mock, usageUnavailable: unavailableCalls > 0 }) };
}
