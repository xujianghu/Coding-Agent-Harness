import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'path';
import { loadConfig } from './loader';
import { loadGuardrailRules } from '../governance/load-rules';

export const DEFAULT_CONFIG_YAML = `llm:
  provider: openai
  model: gpt-4o
  maxTokens: 4096
  temperature: 0.1

agent:
  maxTurns: 50
  timeout: 300000

governance:
  rulesFile: .harness/guardrails.yaml
  sandbox:
    allowedPaths:
      - ./
    allowedCommands:
      - npm
      - node
      - npx
      - tsc
      - eslint
      - vitest
      - jest
      - git

memory:
  storagePath: .harness/memory/
  maxConversationTurns: 20
`;

/** 初始化与网页配置读取共同拒绝链接，避免跟随不可信项目中的配置指针。 */
export function assertSafeConfigurationPath(input: string, directory = false): void {
  const path = resolve(input);
  let cursor = parse(path).root;
  const parts = relative(cursor, path).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    cursor = join(cursor, parts[index]);
    let stat;
    try { stat = lstatSync(cursor); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('配置路径不允许符号链接或硬链接');
    const last = index === parts.length - 1;
    if ((!last || directory) && !stat.isDirectory()) throw new Error('配置目录必须是普通目录');
    if (last && !directory && (!stat.isFile() || stat.size > 256 * 1024)) throw new Error('配置必须是 256 KiB 以内的普通文件');
  }
}

export function workspaceConfiguration(workspace: string, configPath = join(workspace, '.harness', 'config.yaml')) {
  assertSafeConfigurationPath(join(workspace, '.harness'), true);
  assertSafeConfigurationPath(configPath);
  const config = loadConfig(configPath);
  const rulesPath = isAbsolute(config.governance.rulesFile) ? config.governance.rulesFile : resolve(workspace, config.governance.rulesFile);
  assertSafeConfigurationPath(rulesPath);
  const rulesExist = existsSync(rulesPath);
  const rules = rulesExist ? loadGuardrailRules(rulesPath) : [];
  return { config, rules, rulesPath, initialized: existsSync(configPath) && rulesExist };
}

/** 只创建缺失的固定模板；已有自定义护栏路径和凭据从不被写入。 */
export function initializeWorkspace(input: string): string[] {
  const requested = resolve(input);
  // CLI 初始化保留创建新目录的行为，网页入口仍先要求所选项目已经存在。
  assertSafeConfigurationPath(requested, true);
  mkdirSync(requested, { recursive: true });
  assertSafeConfigurationPath(requested, true);
  const workspace = realpathSync(requested);
  if (!lstatSync(workspace).isDirectory()) throw new Error('工作区必须是目录');
  const directory = join(workspace, '.harness');
  const configPath = join(directory, 'config.yaml');
  const rulesPath = join(directory, 'guardrails.yaml');
  assertSafeConfigurationPath(directory, true);
  assertSafeConfigurationPath(configPath);
  assertSafeConfigurationPath(rulesPath);
  mkdirSync(directory, { recursive: true });
  const created: string[] = [];
  for (const [path, content] of [[configPath, DEFAULT_CONFIG_YAML], [rulesPath, DEFAULT_GUARDRAILS_YAML]]) {
    assertSafeConfigurationPath(dirname(path), true);
    assertSafeConfigurationPath(path);
    try { writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); created.push(path === configPath ? 'config.yaml' : 'guardrails.yaml'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; assertSafeConfigurationPath(path); }
  }
  return created;
}

export const DEFAULT_GUARDRAILS_YAML = `rules:
  - name: no-destructive-commands
    pattern: "rm -rf|rm -r|del /f|format"
    severity: critical
    action: block
    type: command
  - name: no-env-file-access
    pattern: "\\\\.env"
    severity: high
    action: block
    type: file
  - name: no-system-directory-write
    pattern: "^/(etc|sys|proc|dev)/"
    severity: high
    action: block
    type: file
  - name: no-package-lock-write
    pattern: "package-lock\\\\.json"
    severity: medium
    action: approve
    type: file
  - name: no-git-config-write
    pattern: "\\\\.git/config"
    severity: critical
    action: block
    type: file
`;
