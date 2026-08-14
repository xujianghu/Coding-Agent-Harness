import {
  parseResponse,
  executeAction,
  trimConversationHistory,
  AgentCallbacks,
} from './loop';
import { AgentConfig, LLMProvider, ToolDefinition } from './types';

function buildChatSystemPrompt(tools: ToolDefinition[]): string {
  const toolList = tools
    .map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `    "${k}": ${v.type} // ${v.description}${v.required ? ' (required)' : ''}`)
        .join('\n');
      return `  ${t.name}: ${t.description}\n  parameters:\n${params}`;
    })
    .join('\n\n');

  return `You are a coding assistant in an interactive CLI. You have tools available for reading, writing and deleting files, running shell commands, and running tests/lint.

Use a tool whenever you need to inspect or modify the workspace. After each tool call you'll receive its result, then continue or reply in plain text. When you've finished the user's request, reply in plain text.

Available tools:
${toolList}`;
}

export interface ChatLoop {
  send(userInput: string): Promise<string>;
}

export function createChatLoop(
  config: AgentConfig,
  llm: LLMProvider,
  tools: ToolDefinition[],
  callbacks: AgentCallbacks,
): ChatLoop {
  const systemPrompt = buildChatSystemPrompt(tools);
  let messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  return {
    async send(userInput: string): Promise<string> {
      messages.push({ role: 'user', content: userInput });
      let actionsThisTurn = 0;

      while (true) {
        callbacks.onMessage?.(messages);
        const response = await llm.complete(messages, tools);
        const parsed = parseResponse(response.content, response.toolCalls);

        if (parsed.kind === 'text') {
          messages.push({ role: 'assistant', content: response.content });
          return parsed.text || '(empty response)';
        }

        if (parsed.kind === 'done') {
          messages.push({ role: 'assistant', content: response.content });
          return parsed.summary || 'Done';
        }

        // kind === 'action'
        const action = parsed.action;
        // function calling 时 response.content 可能为空，记录工具调用详情，让 agent 记住自己做了什么。
        messages.push({
          role: 'assistant',
          content: response.content || `调用工具 ${action.type} ${JSON.stringify(action.params)}`,
        });

        actionsThisTurn++;
        if (actionsThisTurn > config.agent.maxTurns) {
          messages.push({
            role: 'user',
            content: 'Too many actions for a single turn. Please summarize and stop.',
          });
          return 'Reached the maximum number of actions for this turn.';
        }

        const approval = await callbacks.onAction?.(action, actionsThisTurn);
        if (approval && !approval.allowed) {
          messages.push({
            role: 'user',
            content: `Action blocked: ${approval.reason || 'not allowed'}`,
          });
          messages = trimConversationHistory(messages, config.memory.maxConversationTurns);
          continue;
        }

        const result = await executeAction(tools, action);
        messages.push({
          role: 'user',
          content: `${action.type} ${JSON.stringify(action.params)} 结果: ${JSON.stringify(result)}`,
        });
        messages = trimConversationHistory(messages, config.memory.maxConversationTurns);
      }
    },
  };
}
