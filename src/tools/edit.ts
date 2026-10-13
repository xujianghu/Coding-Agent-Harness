import { createHash } from 'crypto';
import { readFileSync, statSync, writeFileSync } from 'fs';
import { ToolDefinition } from '../core/types';
import { resolveWorkspacePath } from './path';

export function createApplyPatchTool(root: string): ToolDefinition {
  return {
    name: 'apply_patch',
    description: '将唯一匹配的原文替换为新文；原文不匹配、重复或版本改变时拒绝写入',
    parameters: {
      path: { type: 'string', description: '工作区内已有文件的相对路径', required: true },
      old_text: { type: 'string', description: '需要替换的精确原文，不能为空', required: true },
      new_text: { type: 'string', description: '替换后的内容，可为空以删除原文', required: true },
      expected_sha256: { type: 'string', description: '读取时的文件摘要，可选；不一致则拒绝写入', required: false },
    },
    execute: async (params, context) => {
      try {
        context?.signal?.throwIfAborted();
        if (!params.old_text) throw new Error('old_text 不能为空');
        const file = resolveWorkspacePath(root, params.path);
        if (!statSync(file).isFile() || statSync(file).size > 1024 * 1024) throw new Error('只支持 1 MiB 以内的普通文本文件');
        const bytes = readFileSync(file);
        if (bytes.includes(0)) throw new Error('不支持修改二进制文件');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (params.expected_sha256 && params.expected_sha256 !== sha256) throw new Error('文件版本已改变，请重新读取后应用补丁');
        const content = bytes.toString('utf8');
        const offset = content.indexOf(params.old_text);
        if (offset === -1) throw new Error('找不到精确匹配的原文，请重新读取文件');
        if (content.indexOf(params.old_text, offset + 1) !== -1) throw new Error('原文匹配多处，请提供更多上下文');
        const patched = content.slice(0, offset) + params.new_text + content.slice(offset + params.old_text.length);
        if (Buffer.byteLength(patched, 'utf8') > 1024 * 1024) throw new Error('补丁结果超过 1 MiB 上限');
        context?.signal?.throwIfAborted();
        writeFileSync(file, patched, 'utf8');
        return { success: true, output: JSON.stringify({ path: params.path, replacements: 1, sha256: createHash('sha256').update(patched).digest('hex') }) };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
