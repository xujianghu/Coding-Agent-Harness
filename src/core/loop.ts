import {
  AgentConfig,
  AgentAction,
  ActionResult,
  ConversationTurn,
  AgentState,
  AgentRunResult,
  LLMProvider,
  ToolDefinition,
  AgentCallbacks,
} from './types';

function buildSystemPrompt(tools: ToolDefinition[]): string {
  const toolList = tools
    .map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `    "${k}": ${v.type} // ${v.description}${v.required ? ' (required)' : ''}`)
        .join('\n');
      return `  ${t.name}: ${t.description}\n  parameters:\n${params}`;
    })
    .join('\n\n');

  return `You are a coding agent. Respond ONLY with JSON in one of these formats:

1. To perform an action:
\`\`\`json
{"action": {"type": "<tool_name>", "params": { ... }}}
\`\`\`

2. To signal completion:
\`\`\`json
{"done": true, "summary": "<what was accomplished>"}
\`\`\`

Available tools:
${toolList}`;
}

function parseResponse(content: string): { action?: AgentAction; done?: boolean; summary?: string } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  let jsonStr = trimmed;

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.action && parsed.action.type && parsed.action.params) {
      return { action: parsed.action };
    }
    if (parsed.done) {
      return { done: true, summary: parsed.summary || '' };
    }
    return null;
  } catch {
    return null;
  }
}

function executeAction(tools: ToolDefinition[], action: AgentAction): Promise<ActionResult> {
  const tool = tools.find((t) => t.name === action.type);
  if (!tool) {
    return Promise.resolve({
      success: false,
      output: '',
      error: `Unknown tool: ${action.type}`,
    });
  }
  return tool.execute(action.params);
}

export interface AgentRunResult {
  state: AgentState;
  turns: number;
  summary: string;
  history: ConversationTurn[];
}

export interface AgentCallbacks {
  onAction?: (action: AgentAction, turn: number) => { allowed: boolean; reason?: string } | void;
  onTurn?: (turn: ConversationTurn) => void;
  onStop?: (reason: string) => void;
}

export function createAgentLoop(
  config: AgentConfig,
  llm: LLMProvider,
  tools: ToolDefinition[],
  callbacks: AgentCallbacks,
) {
  return {
    async run(task: string): Promise<AgentRunResult> {
      const history: ConversationTurn[] = [];
      const systemPrompt = buildSystemPrompt(tools);
      const messages: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ];

      history.push({
        role: 'user',
        content: task,
        timestamp: Date.now(),
      });

      let turns = 0;
      let summary = '';
      let state: AgentState = 'running';
      const maxTurns = config.agent.maxTurns;

      while (turns < maxTurns) {
        const response = await llm.complete(messages);
        turns++;

        if (!response.content || response.content.trim() === '') {
          state = 'completed';
          callbacks.onStop?.('empty response');
          break;
        }

        const parsed = parseResponse(response.content);

        if (!parsed) {
          state = 'completed';
          callbacks.onStop?.('unparseable response');
          break;
        }

        if (parsed.done) {
          summary = parsed.summary || '';
          state = 'completed';
          callbacks.onStop?.('done signal');
          break;
        }

        if (parsed.action) {
          const action = parsed.action;

          const approval = callbacks.onAction?.(action, turns);
          if (approval && !approval.allowed) {
            const blockedResult: ActionResult = {
              success: false,
              output: '',
              error: approval.reason || 'Action blocked',
            };

            const turn: ConversationTurn = {
              role: 'assistant',
              content: response.content,
              timestamp: Date.now(),
              action,
              result: blockedResult,
            };

            history.push(turn);
            callbacks.onTurn?.(turn);

            messages.push({ role: 'assistant', content: response.content });
            messages.push({
              role: 'feedback',
              content: `Action blocked: ${approval.reason || 'not allowed'}`,
            });
            continue;
          }

          const result = await executeAction(tools, action);

          const turn: ConversationTurn = {
            role: 'assistant',
            content: response.content,
            timestamp: Date.now(),
            action,
            result,
          };

          history.push(turn);
          callbacks.onTurn?.(turn);

          messages.push({ role: 'assistant', content: response.content });
          messages.push({
            role: 'feedback',
            content: `Action result: ${JSON.stringify(result)}`,
          });
        }
      }

      if (state === 'running') {
        state = 'stopped';
        callbacks.onStop?.('maxTurns reached');
      }

      return { state, turns, summary, history };
    },
  };
}