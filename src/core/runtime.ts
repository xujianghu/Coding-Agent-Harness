import { LLMMessage } from './types';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('操作已取消');
}

/** 供应商未返回用量时的预算估算，不等同于实际计费。 */
export function estimateTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8') / 3);
}

export function estimateContextTokens(messages: LLMMessage[], tools: unknown = []): number {
  return estimateTokens(messages) + estimateTokens(tools);
}

/** 取消等待后不再推进循环；适用于没有工作区副作用的请求与审批。 */
export function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('操作已取消'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

export function limitText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = '\n[输出已截断]';
  return maxChars <= marker.length ? marker.slice(0, maxChars) : text.slice(0, maxChars - marker.length) + marker;
}
