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
  },
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
    return { ...DefaultConfig };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: Partial<AgentConfig> | null;
  try {
    parsed = yaml.parse(raw) as Partial<AgentConfig>;
  } catch (e) {
    console.warn(
      `配置解析失败: ${filePath}。YAML 格式错误，将回退到默认配置。错误详情: ${(e as Error).message}`,
    );
    return { ...DefaultConfig };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ...DefaultConfig };
  }

  return deepMerge(DefaultConfig, parsed);
}