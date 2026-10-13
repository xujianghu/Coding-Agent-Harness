import { parseResponse, executeAction, trimConversationHistory, AgentCallbacks, validateAction } from './loop';
import { AgentConfig, LLMProvider, ToolDefinition, LLMMessage, AgentAction, ActionResult, LLMToolCall } from './types';
import { estimateContextTokens, estimateTokens, limitText, throwIfAborted, waitWithSignal } from './runtime';

export interface ChatLoop {
  send(userInput: string, options?: { signal?: AbortSignal }): Promise<string>;
}

export function createChatLoop(config: AgentConfig, llm: LLMProvider, tools: ToolDefinition[], callbacks: AgentCallbacks): ChatLoop {
  let messages: LLMMessage[] = [{ role: 'system', content: '你是交互式编码助手。使用原生工具调用或 JSON action 操作仓库，收到结果后继续。完成后回复用户。' }];
  let totalTokens = 0;
  let active = false;
  return {
    async send(userInput: string, options = {}): Promise<string> {
      if (active) throw new Error('聊天循环不能并发执行');
      active = true;
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason ?? new Error('操作已取消'));
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      const timer = setTimeout(() => controller.abort(new Error(`Agent timed out after ${config.agent.timeout}ms`)), config.agent.timeout);
      const signal = controller.signal;
      const started = Date.now();
      const assertActive = () => {
        if (Date.now() - started >= config.agent.timeout) controller.abort(new Error(`Agent timed out after ${config.agent.timeout}ms`));
        throwIfAborted(signal);
      };
      messages.push({ role: 'user', content: userInput });
      let actions = 0;
      let rounds = 0;
      let pendingCalls: LLMToolCall[] = [];
      const finish = (reply: string) => { messages.push({ role: 'assistant', content: reply }); return reply; };
      try {
        while (true) {
          assertActive();
          if (rounds++ >= config.agent.maxTurns) return finish('Reached the maximum number of actions for this turn.');
          messages = trimConversationHistory(messages, config.memory.maxConversationTurns, config.memory.maxContextTokens);
          const promptEstimate = estimateContextTokens(messages, tools.map(({ execute: _execute, ...tool }) => tool));
          if (config.memory.maxContextTokens !== undefined && promptEstimate > config.memory.maxContextTokens) return finish('上下文已超过 Token 预算，请开始新的会话。');
          const remaining = config.agent.maxTotalTokens === undefined ? Infinity : config.agent.maxTotalTokens - totalTokens - promptEstimate;
          if (remaining <= 0) return finish('会话 Token 预算已耗尽。');
          callbacks.onMessage?.(JSON.parse(JSON.stringify(messages)));
          const response = await waitWithSignal(llm.complete([...messages], tools, { signal, maxTokens: Math.min(config.llm.maxTokens, remaining), temperature: config.llm.temperature }), signal);
          assertActive();
          totalTokens += response.usage?.totalTokens ?? promptEstimate + estimateTokens(response);
          if (config.agent.maxTotalTokens !== undefined && totalTokens >= config.agent.maxTotalTokens) return finish('会话 Token 预算已耗尽。');
          const parsed = parseResponse(response.content, response.toolCalls);
          if (parsed.kind === 'text') return finish(parsed.text || '(empty response)');
          if (parsed.kind === 'done') {
            if (callbacks.onVerify) {
              const result = await callbacks.onVerify({ task: userInput, summary: parsed.summary, history: [], signal });
              assertActive();
              if (!result.success) {
                messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: `独立验收失败：${JSON.stringify(result)}` });
                continue;
              }
            }
            return finish(parsed.summary || 'Done');
          }
          const native = !!response.toolCalls?.length;
          const calls = response.toolCalls?.length ? response.toolCalls.map((call, index) => ({ ...call, id: call.id || `chat_${actions}_${index}` })) : undefined;
          if (actions + (calls?.length ?? 1) > config.agent.maxTurns) return finish('Reached the maximum number of actions for this turn.');
          messages.push({ role: 'assistant', content: response.content, ...(native ? { toolCalls: calls } : {}) });
          pendingCalls = calls ? [...calls] : [];
          const actionList: AgentAction[] = calls ? calls.map(call => ({ type: call.name as AgentAction['type'], params: call.arguments, toolCallId: call.id })) : [parsed.action];
          for (const action of actionList) {
            assertActive();
            actions++;
            const error = validateAction(tools, action);
            let result: ActionResult;
            if (error) result = { success: false, output: '', error };
            else {
              const approval = await waitWithSignal(Promise.resolve(callbacks.onAction?.(action, actions, { signal })), signal);
              assertActive();
              result = approval && !approval.allowed ? { success: false, output: '', error: approval.reason || 'blocked' } : await executeAction(tools, action, { signal });
            }
            assertActive();
            result.output = limitText(result.output, config.memory.maxToolOutputChars ?? 16000);
            if (result.error) result.error = limitText(result.error, config.memory.maxToolOutputChars ?? 16000);
            messages.push(native ? { role: 'tool', content: JSON.stringify(result), name: action.type, toolCallId: action.toolCallId }
              : { role: 'user', content: `${action.type} 结果: ${JSON.stringify(result)}` });
            if (native) pendingCalls.shift();
            callbacks.onTurn?.({ role: 'assistant', content: response.content, timestamp: Date.now(), action, result });
          }
        }
      } catch (error) {
        // 取消不能遗留无结果的原生调用，否则下一条消息会破坏供应商协议。
        for (const call of pendingCalls) {
          messages.push({ role: 'tool', name: call.name, toolCallId: call.id,
            content: JSON.stringify({ success: false, output: '', error: '调用已中断，执行状态需重新检查工作区，禁止自动重放' }) });
        }
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        active = false;
      }
    },
  };
}
