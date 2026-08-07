import type { MemoryEntry } from '../core/types';
import type { MemoryStore } from './store';

interface MemoryRetriever {
  search(query: string, options?: { category?: string }): Promise<MemoryEntry[]>;
}

function createMemoryRetriever(store: MemoryStore): MemoryRetriever {
  return {
    async search(query: string, options?: { category?: string }): Promise<MemoryEntry[]> {
      const entries = await store.list();
      const lowerQuery = query.toLowerCase();

      let results = entries.filter(
        (entry) =>
          entry.key.toLowerCase().includes(lowerQuery) ||
          entry.value.toLowerCase().includes(lowerQuery)
      );

      if (options?.category) {
        results = results.filter((entry) => entry.category === options.category);
      }

      return results;
    },
  };
}

export { createMemoryRetriever, MemoryRetriever };