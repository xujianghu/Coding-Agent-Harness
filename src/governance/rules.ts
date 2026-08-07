export interface GuardrailRule {
  name: string;
  pattern: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'block' | 'approve';
  type?: string;
}