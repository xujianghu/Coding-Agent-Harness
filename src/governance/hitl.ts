import { AgentAction } from '../core/types';

export interface HITLStateMachine {
  requestApproval(action: AgentAction): void;
  approve(): void;
  reject(reason: string): void;
  getState(): 'idle' | 'pending' | 'approved' | 'rejected';
  getPendingAction(): AgentAction | null;
  getRejectReason(): string | null;
}

export function createHITL(): HITLStateMachine {
  let state: 'idle' | 'pending' | 'approved' | 'rejected' = 'idle';
  let pendingAction: AgentAction | null = null;
  let rejectReason: string | null = null;

  return {
    requestApproval(action: AgentAction): void {
      pendingAction = action;
      state = 'pending';
    },

    approve(): void {
      if (state !== 'pending') {
        throw new Error('Cannot approve in idle state');
      }
      state = 'approved';
    },

    reject(reason: string): void {
      if (state !== 'pending') {
        throw new Error('Cannot reject in idle state');
      }
      state = 'rejected';
      rejectReason = reason;
    },

    getState() {
      return state;
    },

    getPendingAction() {
      return pendingAction;
    },

    getRejectReason() {
      return rejectReason;
    },
  };
}