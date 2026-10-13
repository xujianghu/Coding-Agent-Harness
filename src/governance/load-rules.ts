import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { GuardrailRule } from './rules';

export function validateRulesDocument(document: unknown): GuardrailRule[] {
  if (!document || typeof document !== 'object' || !Array.isArray((document as { rules?: unknown }).rules)) throw new Error('护栏文件必须包含 rules 数组');
  const rules = (document as { rules: unknown[] }).rules;
  const names = new Set<string>();
  return rules.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('护栏规则必须是对象');
    const rule = value as GuardrailRule;
    if (typeof rule.name !== 'string' || !rule.name.trim() || names.has(rule.name)) throw new Error('护栏规则名称为空或重复');
    if (typeof rule.pattern !== 'string' || !rule.pattern.trim()) throw new Error(`护栏规则 ${rule.name} 缺少 pattern`);
    if (rule.type !== undefined && !['command', 'file'].includes(rule.type)) throw new Error(`护栏规则 ${rule.name} 的 type 必须是 command 或 file`);
    if (!['block', 'approve'].includes(rule.action) || !['low', 'medium', 'high', 'critical'].includes(rule.severity)) throw new Error(`护栏规则 ${rule.name} 的 action 或 severity 无效`);
    new RegExp(rule.pattern, 'i');
    names.add(rule.name);
    return { ...rule };
  });
}

export function loadGuardrailRules(file: string): GuardrailRule[] {
  return validateRulesDocument(parse(readFileSync(file, 'utf8')));
}
