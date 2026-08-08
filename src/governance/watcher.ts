import { watch, existsSync, readFileSync, FSWatcher } from 'fs';
import { parse } from 'yaml';
import type { GuardrailEngine } from './guardrail';
import type { GuardrailRule } from './rules';

export function createGuardrailWatcher(
  rulesPath: string,
  engine: GuardrailEngine,
  onReload?: (rules: GuardrailRule[]) => void,
): { start: () => void; stop: () => void } {
  let watcher: FSWatcher | null = null;

  function reload() {
    try {
      if (!existsSync(rulesPath)) {
        console.warn(`[Guardrail] Rules file not found: ${rulesPath}`);
        return;
      }
      const content = readFileSync(rulesPath, 'utf-8');
      const parsed = parse(content);
      if (parsed && typeof parsed === 'object' && 'rules' in parsed) {
        const newRules = (parsed as { rules: GuardrailRule[] }).rules;
        engine.replaceRules(newRules);
        onReload?.(newRules);
      } else {
        console.warn('[Guardrail] Invalid rules file format, keeping old rules');
      }
    } catch (err) {
      console.warn(`[Guardrail] Failed to reload rules: ${err}`);
    }
  }

  return {
    start() {
      if (!existsSync(rulesPath)) {
        console.warn(`[Guardrail] Rules file not found: ${rulesPath}`);
        return;
      }

      watcher = watch(rulesPath, (eventType) => {
        if (eventType === 'change') {
          console.log('[Guardrail] Rules file changed, reloading...');
          reload();
        }
      });

      watcher.on('error', (err) => {
        console.warn(`[Guardrail] Watcher error: ${err}`);
      });
    },
    stop() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}