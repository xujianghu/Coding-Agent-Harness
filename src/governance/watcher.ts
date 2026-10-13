import { watch, existsSync, FSWatcher } from 'fs';
import type { GuardrailEngine } from './guardrail';
import type { GuardrailRule } from './rules';
import { loadGuardrailRules } from './load-rules';

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
      const newRules = loadGuardrailRules(rulesPath);
      engine.replaceRules(newRules);
      onReload?.(newRules);
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
