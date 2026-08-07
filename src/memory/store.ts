import { readFile, writeFile, readdir, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import type { MemoryEntry } from '../core/types';

interface MemoryStore {
  set(key: string, value: string, category: MemoryEntry['category']): Promise<void>;
  get(key: string): Promise<MemoryEntry | null>;
  list(): Promise<MemoryEntry[]>;
  delete(key: string): Promise<void>;
}

function safeFileName(key: string): string {
  return key.replace(/[\/\\:*?"<>|]/g, '_') + '.json';
}

async function createMemoryStore(storagePath: string): Promise<MemoryStore> {
  if (!existsSync(storagePath)) {
    await mkdir(storagePath, { recursive: true });
  }

  return {
    async set(key: string, value: string, category: MemoryEntry['category']): Promise<void> {
      const entry: MemoryEntry = {
        key,
        value,
        category,
        timestamp: Date.now(),
      };
      const filePath = path.join(storagePath, safeFileName(key));
      await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    },

    async get(key: string): Promise<MemoryEntry | null> {
      const filePath = path.join(storagePath, safeFileName(key));
      if (!existsSync(filePath)) {
        return null;
      }
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as MemoryEntry;
    },

    async list(): Promise<MemoryEntry[]> {
      if (!existsSync(storagePath)) {
        return [];
      }
      const entries: MemoryEntry[] = [];
      const files = await readdir(storagePath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await readFile(path.join(storagePath, file), 'utf-8');
          entries.push(JSON.parse(content) as MemoryEntry);
        }
      }
      return entries;
    },

    async delete(key: string): Promise<void> {
      const filePath = path.join(storagePath, safeFileName(key));
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    },
  };
}

export { createMemoryStore, MemoryStore };