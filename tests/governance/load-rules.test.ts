import { describe, expect, it } from 'vitest';
import { validateRulesDocument } from '../../src/governance/load-rules';

const valid = { name: 'block', pattern: 'dangerous', action: 'block', severity: 'high' };
describe('护栏文档校验', () => {
  it.each([null, {}, { rules: null }, { rules: [null] }, { rules: [{}] }, { rules: [{ ...valid, pattern: '[' }] }, { rules: [{ ...valid, action: 'allow' }] }, { rules: [{ ...valid, type: 'typo' }] }, { rules: [valid, valid] }])('无效策略不能静默变成空护栏：%j', document => {
    expect(() => validateRulesDocument(document)).toThrow();
  });
  it('显式空数组可用，有效规则完整保留', () => {
    expect(validateRulesDocument({ rules: [] })).toEqual([]);
    expect(validateRulesDocument({ rules: [valid] })).toEqual([valid]);
  });
});
