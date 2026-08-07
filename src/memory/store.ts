import * as fs from 'fs';
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

function createMemoryStore(storagePath: string): MemoryStore {
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
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
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    },

    async get(key: string): Promise<MemoryEntry | null> {
      const filePath = path.join(storagePath, safeFileName(key));
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as MemoryEntry;
    },

    async list(): Promise<MemoryEntry[]> {
      if (!fs.existsSync(storagePath)) {
        return [];
      }
      const entries: MemoryEntry[] = [];
      const files = fs.readdirSync(storagePath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = fs.readFileSync(path.join(storagePath, file), 'utf-8');
          entries.push(JSON.parse(content) as MemoryEntry);
        }
      }
      return entries;
    },

    async delete(key: string): Promise<void> {
      const filePath = path.join(storagePath, safeFileName(key));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    },
  };
}

export { createMemoryStore, MemoryStore };