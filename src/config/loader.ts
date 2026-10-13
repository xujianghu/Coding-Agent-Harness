import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { AgentConfig } from '../core/types';

export const DefaultConfig: AgentConfig = {
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    maxTokens: 4096,
    temperature: 0.1,
  },
  agent: {
    maxTurns: 50,
    timeout: 300000,
    maxTotalTokens: 100000,
  },
  execution: { mode: 'docker', image: 'node:22-alpine', timeout: 120000 },
  governance: {
    rulesFile: '.harness/guardrails.yaml',
    sandbox: {
      allowedPaths: ['./workspace', './src', './tests'],
      allowedCommands: ['npm', 'node', 'npx', 'tsc', 'eslint', 'vitest', 'jest', 'git'],
    },
  },
  memory: {
    storagePath: '.harness/memory/',
    maxConversationTurns: 20,
    maxContextTokens: 16000,
    maxToolOutputChars: 12000,
  },
};

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const sourceVal = (source as Record<string, unknown>)[key];
    const targetVal = (target as Record<string, unknown>)[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result as T;
}

export function loadConfig(filePath: string): AgentConfig {
  if (!fs.existsSync(filePath)) {
    return structuredClone(DefaultConfig);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: Partial<AgentConfig> | null;
  try {
    parsed = yaml.parse(raw) as Partial<AgentConfig>;
  } catch (e) {
    throw new Error(`配置解析失败: ${filePath}。${(e as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配置必须是非空 YAML 对象');
  }

  const config = deepMerge(structuredClone(DefaultConfig), parsed);
  validateConfig(config);
  return config;
}

export function validateConfig(config: AgentConfig): void {
  const positive = (value: unknown, name: string): void => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  };
  if (!config.llm || !['openai', 'anthropic', 'gemini'].includes(config.llm.provider)) throw new Error('llm.provider 无效');
  if (typeof config.llm.model !== 'string' || !config.llm.model.trim()) throw new Error('llm.model 不能为空');
  positive(config.llm.maxTokens, 'llm.maxTokens');
  if (typeof config.llm.temperature !== 'number' || !Number.isFinite(config.llm.temperature) || config.llm.temperature < 0 || config.llm.temperature > 2) throw new Error('llm.temperature 必须在 0 到 2 之间');
  if (config.llm.baseUrl !== undefined) {
    const url = new URL(config.llm.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('llm.baseUrl 必须是无内嵌凭据的 HTTP 地址');
  }
  if (!config.agent || !config.memory || !config.governance?.sandbox) throw new Error('agent、memory 与 governance.sandbox 配置不能为空');
  positive(config.agent.maxTurns, 'agent.maxTurns');
  positive(config.agent.timeout, 'agent.timeout');
  if (config.agent.maxTotalTokens !== undefined) positive(config.agent.maxTotalTokens, 'agent.maxTotalTokens');
  positive(config.memory.maxConversationTurns, 'memory.maxConversationTurns');
  if (config.memory.maxContextTokens !== undefined) positive(config.memory.maxContextTokens, 'memory.maxContextTokens');
  if (config.memory.maxToolOutputChars !== undefined) positive(config.memory.maxToolOutputChars, 'memory.maxToolOutputChars');
  if (typeof config.governance.rulesFile !== 'string' || !config.governance.rulesFile.trim()) throw new Error('governance.rulesFile 不能为空');
  for (const [name, list] of Object.entries(config.governance.sandbox)) {
    if (!['allowedPaths', 'allowedCommands'].includes(name)) continue;
    if (!Array.isArray(list) || list.length === 0 || list.some((entry) => typeof entry !== 'string' || !entry.trim())) throw new Error(`sandbox.${name} 必须是非空字符串数组`);
  }
  if (config.execution && !['local', 'docker'].includes(config.execution.mode)) throw new Error('execution.mode 仅支持 local 或 docker');
  if (config.execution?.timeout !== undefined) positive(config.execution.timeout, 'execution.timeout');
  if (config.execution?.image !== undefined && (!config.execution.image.trim() || /[\s,]/.test(config.execution.image))) throw new Error('execution.image 无效');
}
