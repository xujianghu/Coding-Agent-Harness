import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, DefaultConfig } from '../../src/config/loader';
import type { AgentConfig } from '../../src/core/types';

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function writeYaml(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  describe('YAML 文件加载正确解析各字段', () => {
    it('应正确解析 LLM 配置', () => {
      const yamlContent = `
llm:
  provider: anthropic
  model: claude-3-opus
  maxTokens: 8192
  temperature: 0.5
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      writeYaml(configPath, yamlContent);

      const config = loadConfig(configPath);

      expect(config.llm.provider).toBe('anthropic');
      expect(config.llm.model).toBe('claude-3-opus');
      expect(config.llm.maxTokens).toBe(8192);
      expect(config.llm.temperature).toBe(0.5);
    });

    it('应正确解析 agent 配置', () => {
      const yamlContent = `
agent:
  maxTurns: 30
  timeout: 120000
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      writeYaml(configPath, yamlContent);

      const config = loadConfig(configPath);

      expect(config.agent.maxTurns).toBe(30);
      expect(config.agent.timeout).toBe(120000);
    });

    it('应正确解析 governance 配置', () => {
      const yamlContent = `
governance:
  rulesFile: custom/rules.yaml
  sandbox:
    allowedPaths:
      - /custom/path
      - /other/path
    allowedCommands:
      - python
      - make
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      writeYaml(configPath, yamlContent);

      const config = loadConfig(configPath);

      expect(config.governance.rulesFile).toBe('custom/rules.yaml');
      expect(config.governance.sandbox.allowedPaths).toEqual(['/custom/path', '/other/path']);
      expect(config.governance.sandbox.allowedCommands).toEqual(['python', 'make']);
    });

    it('应正确解析 memory 配置', () => {
      const yamlContent = `
memory:
  storagePath: custom/memory/
  maxConversationTurns: 10
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      writeYaml(configPath, yamlContent);

      const config = loadConfig(configPath);

      expect(config.memory.storagePath).toBe('custom/memory/');
      expect(config.memory.maxConversationTurns).toBe(10);
    });

    it('应正确解析完整配置', () => {
      const yamlContent = `
llm:
  provider: gemini
  model: gemini-2.0-flash
  maxTokens: 2048
  temperature: 0.2
agent:
  maxTurns: 100
  timeout: 600000
governance:
  rulesFile: .harness/custom-guardrails.yaml
  sandbox:
    allowedPaths:
      - ./src
      - ./lib
    allowedCommands:
      - npm
      - node
      - python
memory:
  storagePath: .harness/memory-v2/
  maxConversationTurns: 100
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      writeYaml(configPath, yamlContent);

      const config = loadConfig(configPath);

      expect(config.llm.provider).toBe('gemini');
      expect(config.llm.model).toBe('gemini-2.0-flash');
      expect(config.llm.maxTokens).toBe(2048);
      expect(config.llm.temperature).toBe(0.2);
      expect(config.agent.maxTurns).toBe(100);
      expect(config.agent.timeout).toBe(600000);
      expect(config.governance.rulesFile).toBe('.harness/custom-guardrails.yaml');
      expect(config.governance.sandbox.allowedPaths).toEqual(['./src', './lib']);
      expect(config.governance.sandbox.allowedCommands).toEqual(['npm', 'node', 'python']);
      expect(config.memory.storagePath).toBe('.harness/memory-v2/');
      expect(config.memory.maxConversationTurns).toBe(100);
    });

    it('部分覆盖时应与默认配置深度合并', () => {
      const yamlContent = `
llm:
  model: gpt-4-turbo
`;
      const configPath = path.join(tmpDir, 'config.yaml');
      writeYaml(configPath, yamlContent);

      const config = loadConfig(configPath);

      expect(config.llm.model).toBe('gpt-4-turbo');
      expect(config.llm.provider).toBe(DefaultConfig.llm.provider);
      expect(config.llm.maxTokens).toBe(DefaultConfig.llm.maxTokens);
      expect(config.llm.temperature).toBe(DefaultConfig.llm.temperature);
      expect(config.agent).toEqual(DefaultConfig.agent);
      expect(config.governance).toEqual(DefaultConfig.governance);
      expect(config.memory).toEqual(DefaultConfig.memory);
    });
  });

  describe('文件不存在时返回默认配置', () => {
    it('应返回默认配置', () => {
      const nonExistentPath = path.join(tmpDir, 'non-existent.yaml');

      const config = loadConfig(nonExistentPath);

      expect(config).toEqual(DefaultConfig);
    });
  });
});

describe('DefaultConfig', () => {
  it('应包含预期的默认值', () => {
    expect(DefaultConfig).toBeDefined();
    expect(DefaultConfig.llm.provider).toBe('openai');
    expect(DefaultConfig.llm.model).toBe('gpt-4o');
    expect(DefaultConfig.llm.maxTokens).toBe(4096);
    expect(DefaultConfig.llm.temperature).toBe(0.1);
    expect(DefaultConfig.agent.maxTurns).toBe(50);
    expect(DefaultConfig.agent.timeout).toBe(300000);
    expect(DefaultConfig.governance.rulesFile).toBe('.harness/guardrails.yaml');
    expect(DefaultConfig.governance.sandbox.allowedPaths).toContain('./workspace');
    expect(DefaultConfig.governance.sandbox.allowedCommands).toContain('npm');
    expect(DefaultConfig.memory.storagePath).toBe('.harness/memory/');
    expect(DefaultConfig.memory.maxConversationTurns).toBe(20);
  });
});