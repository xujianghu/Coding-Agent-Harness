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

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key as string] = sourceVal;
    }
  }
  return result;
}

export function loadConfig(filePath: string): AgentConfig {
  if (!fs.existsSync(filePath)) {
    return { ...DefaultConfig };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.parse(raw) as Partial<AgentConfig>;

  if (!parsed || typeof parsed !== 'object') {
    return { ...DefaultConfig };
  }

  return deepMerge(DefaultConfig, parsed);
}