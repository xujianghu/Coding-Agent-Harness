import type { ToolDefinition, AgentAction, ActionResult } from '../core/types';

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  dispatch(action: AgentAction): Promise<ActionResult>;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();

  return {
    register(tool: ToolDefinition): void {
      tools.set(tool.name, tool);
    },

    get(name: string): ToolDefinition | undefined {
      return tools.get(name);
    },

    list(): ToolDefinition[] {
      return Array.from(tools.values());
    },

    async dispatch(action: AgentAction): Promise<ActionResult> {
      const tool = tools.get(action.type);
      if (!tool) {
        return { success: false, output: '', error: `Unknown tool: ${action.type}` };
      }
      try {
        return await tool.execute(action.params);
      } catch (err) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}