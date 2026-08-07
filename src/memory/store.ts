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

async function createMemoryStore(storagePath: string): Promise<MemoryStore> {
  await mkdir(storagePath, { recursive: true });
  const filePath = path.join(storagePath, 'memory.json');

  async function loadAll(): Promise<Record<string, MemoryEntry>> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async function saveAll(data: Record<string, MemoryEntry>): Promise<void> {
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async function migrateOldFiles(): Promise<void> {
    if (!existsSync(storagePath)) return;
    const files = await readdir(storagePath);
    for (const file of files) {
      if (file.endsWith('.json') && file !== 'memory.json') {
        const oldPath = path.join(storagePath, file);
        if (existsSync(oldPath)) {
          await unlink(oldPath);
        }
      }
    }
  }

  await migrateOldFiles();

  return {
    async set(key, value, category) {
      const data = await loadAll();
      data[key] = { key, value, category, timestamp: Date.now() };
      await saveAll(data);
    },
    async get(key) {
      const data = await loadAll();
      return data[key] || null;
    },
    async list() {
      const data = await loadAll();
      return Object.values(data);
    },
    async delete(key) {
      const data = await loadAll();
      delete data[key];
      await saveAll(data);
    },
  };
}

export { createMemoryStore, MemoryStore };