import { AgentAction } from '../core/types';
import * as readline from 'readline';

export interface HITLStateMachine {
  requestApproval(action: AgentAction): void;
  approve(): void;
  reject(reason: string): void;
  getState(): 'idle' | 'pending' | 'approved' | 'rejected';
  getPendingAction(): AgentAction | null;
  getRejectReason(): string | null;
  requestInteractiveApproval(action: AgentAction): Promise<boolean>;
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

    async requestInteractiveApproval(action: AgentAction): Promise<boolean> {
      this.requestApproval(action);

      console.log(`\n[HITL] Action requires approval:`);
      console.log(`  Type: ${action.type}`);
      console.log(`  Params: ${JSON.stringify(action.params)}`);

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question('Approve? (y/N): ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        this.approve();
        console.log('[HITL] Approved');
        return true;
      } else {
        this.reject('User denied');
        console.log('[HITL] Rejected');
        return false;
      }
    },
  };
}