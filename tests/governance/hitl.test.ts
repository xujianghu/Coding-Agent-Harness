import { describe, it, expect } from 'vitest';
import { createHITL } from '../../src/governance/hitl';
import { AgentAction } from '../../src/core/types';

describe('HITLStateMachine', () => {
  it('should have initial state idle', () => {
    const hitl = createHITL();
    expect(hitl.getState()).toBe('idle');
  });

  it('should transition to pending after requestApproval', () => {
    const hitl = createHITL();
    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'rm -rf /' },
    };
    hitl.requestApproval(action);
    expect(hitl.getState()).toBe('pending');
    expect(hitl.getPendingAction()).toEqual(action);
  });

  it('should transition to approved after approve', () => {
    const hitl = createHITL();
    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'rm -rf /' },
    };
    hitl.requestApproval(action);
    hitl.approve();
    expect(hitl.getState()).toBe('approved');
  });

  it('should transition to rejected after reject with correct reason', () => {
    const hitl = createHITL();
    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'rm -rf /' },
    };
    hitl.requestApproval(action);
    hitl.reject('Dangerous command');
    expect(hitl.getState()).toBe('rejected');
    expect(hitl.getRejectReason()).toBe('Dangerous command');
  });

  it('should throw error when approve is called in idle state', () => {
    const hitl = createHITL();
    expect(() => hitl.approve()).toThrow('Cannot approve in idle state');
  });
});