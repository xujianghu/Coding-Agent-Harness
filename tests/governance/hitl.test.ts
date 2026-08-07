import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHITL, HITLStateMachine } from '../../src/governance/hitl';
import { AgentAction } from '../../src/core/types';
import { Readable } from 'stream';

function mockStdin(input: string) {
  const readable = new Readable();
  readable.push(input);
  readable.push(null);
  Object.defineProperty(process, 'stdin', {
    value: readable,
    writable: true,
    configurable: true,
  });
}

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

describe('requestInteractiveApproval', () => {
  let hitl: HITLStateMachine;
  const action: AgentAction = {
    type: 'shell_exec',
    params: { command: 'rm -rf /' },
  };

  beforeEach(() => {
    hitl = createHITL();
  });

  it('should return true and state approved when user inputs "y"', async () => {
    mockStdin('y\n');

    const result = await hitl.requestInteractiveApproval(action);

    expect(result).toBe(true);
    expect(hitl.getState()).toBe('approved');
  });

  it('should return false and state rejected when user inputs "n"', async () => {
    mockStdin('n\n');

    const result = await hitl.requestInteractiveApproval(action);

    expect(result).toBe(false);
    expect(hitl.getState()).toBe('rejected');
    expect(hitl.getRejectReason()).toBe('User denied');
  });

  it('should return false and state rejected when user inputs empty string', async () => {
    mockStdin('\n');

    const result = await hitl.requestInteractiveApproval(action);

    expect(result).toBe(false);
    expect(hitl.getState()).toBe('rejected');
  });

  it('should return true when user inputs "yes"', async () => {
    mockStdin('yes\n');

    const result = await hitl.requestInteractiveApproval(action);

    expect(result).toBe(true);
    expect(hitl.getState()).toBe('approved');
  });

  it('should return false when user inputs random text', async () => {
    mockStdin('random\n');

    const result = await hitl.requestInteractiveApproval(action);

    expect(result).toBe(false);
    expect(hitl.getState()).toBe('rejected');
  });
});