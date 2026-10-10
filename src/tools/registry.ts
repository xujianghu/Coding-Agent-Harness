import type { ToolDefinition, AgentAction, ActionResult, ToolExecutionContext } from '../core/types';

export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  dispatch(action: AgentAction, context?: ToolExecutionContext): Promise<ActionResult>;
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();
  return {
    register(tool) {
      tools.set(tool.name, tool);
    },
    get(name) {
      return tools.get(name);
    },
    list() {
      return Array.from(tools.values());
    },
    async dispatch(action, context) {
      const tool = tools.get(action.type);
      if (!tool) return { success: false, output: '', error: `Unknown tool: ${action.type}` };
      if (!action.params || typeof action.params !== 'object' || Array.isArray(action.params)) {
        return { success: false, output: '', error: 'Tool parameters must be an object' };
      }
      for (const [name, definition] of Object.entries(tool.parameters)) {
        const value = action.params[name];
        if (definition.required && value === undefined) {
          return { success: false, output: '', error: `Missing required parameter: ${name}` };
        }
        if (value !== undefined && typeof value !== definition.type) {
          return { success: false, output: '', error: `Invalid parameter type: ${name}` };
        }
      }
      for (const name of Object.keys(action.params)) {
        if (!Object.prototype.hasOwnProperty.call(tool.parameters, name)) {
          return { success: false, output: '', error: `Unknown parameter: ${name}` };
        }
      }
      if (context?.signal?.aborted) return { success: false, output: '', error: 'Tool execution aborted' };
      try {
        return await tool.execute(action.params, context);
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
