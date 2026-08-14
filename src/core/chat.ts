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

  return `You are a coding assistant in an interactive CLI.

You can either:
1. Reply directly in plain text to answer questions or explain something.
2. Perform an action (read/write a file, run a shell command, run tests/lint) by responding with ONLY a JSON object:

\`\`\`json
{"action": {"type": "<tool_name>", "params": { ... }}}
\`\`\`

After you perform an action, you will receive a user message with the action result. Use it to decide your next action, or reply with plain text.

When you have finished the user's request, reply with plain text summarizing what you did.

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
        messages.push({ role: 'assistant', content: response.content });

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
          content: `Action result: ${JSON.stringify(result)}`,
        });
        messages = trimConversationHistory(messages, config.memory.maxConversationTurns);
      }
    },
  };
}
