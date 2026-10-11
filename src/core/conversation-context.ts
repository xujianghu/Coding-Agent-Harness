import { LLMMessage, LLMToolCall } from './types';

/** 只继承已完成的消息，历史调用结果不会变成待执行动作。 */
export function validateContextMessages(input: LLMMessage[]): LLMMessage[] {
  if (!Array.isArray(input)) throw new Error('会话上下文必须是消息数组');
  const messages: LLMMessage[] = JSON.parse(JSON.stringify(input));
  const pending = new Map<string, LLMToolCall>();
  const result: LLMMessage[] = [];
  for (const message of messages) {
    if (!message || !['system', 'user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string') {
      throw new Error('会话上下文包含无效消息');
    }
    if (pending.size && message.role !== 'tool') throw new Error('会话上下文包含未完成的工具调用');
    if (message.role === 'tool') {
      const call = typeof message.toolCallId === 'string' ? pending.get(message.toolCallId) : undefined;
      if (!call || message.toolCalls !== undefined || (message.name !== undefined && message.name !== call.name)) {
        throw new Error('会话上下文工具结果与调用不匹配');
      }
      message.name = call.name;
      pending.delete(message.toolCallId!);
    } else {
      if (message.toolCallId !== undefined || message.name !== undefined) throw new Error('会话上下文包含无效工具结果');
      if (message.toolCalls !== undefined) {
        if (message.role !== 'assistant' || !Array.isArray(message.toolCalls)) throw new Error('会话上下文包含无效工具调用');
        for (const call of message.toolCalls) {
          if (!call || typeof call.id !== 'string' || !call.id.trim() || pending.has(call.id)
            || typeof call.name !== 'string' || !call.name.trim() || !call.arguments
            || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
            throw new Error('会话上下文包含无效或重复的工具调用');
          }
          pending.set(call.id, call);
        }
      }
    }
    if (message.role !== 'system') result.push(message);
  }
  if (pending.size) throw new Error('会话上下文包含未完成的工具调用');
  return result;
}
