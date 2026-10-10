import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { previewWorkspace, workspaceChanges } from '../../src/web/changes';

describe('工作区差异预览', () => {
  it('不读取凭据，大文件不阻断展示，截断区域之后的修改也能被识别', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'harness-web-preview-'));
    try {
      writeFileSync(join(workspace, '.env'), 'SECRET=not-for-ui');
      writeFileSync(join(workspace, 'long.txt'), 'x'.repeat(100000));
      writeFileSync(join(workspace, 'large.txt'), 'x'.repeat(1000000));
      const before = previewWorkspace(workspace);
      expect(before.has('.env')).toBe(false);
      expect(before.get('large.txt')).toContain('超过预览上限');
      writeFileSync(join(workspace, 'long.txt'), 'x'.repeat(99999) + 'y');
      const changes = workspaceChanges(before, previewWorkspace(workspace));
      expect(changes.map(change => change.path)).toContain('long.txt');
      expect(changes[0].after!.length).toBeLessThan(9000);
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });
});
