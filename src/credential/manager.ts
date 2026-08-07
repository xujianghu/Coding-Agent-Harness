import * as fs from 'fs';
import * as path from 'path';

interface CredentialManager {
  set(provider: string, key: string): Promise<void>;
  get(provider: string): Promise<string | null>;
  clear(provider: string): Promise<void>;
  status(): Promise<Record<string, boolean>>;
}

function createCredentialManager(storagePath: string): CredentialManager {
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }

  const filePath = path.join(storagePath, 'credentials.json');

  function readData(): Record<string, string> {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, string>;
  }

  function writeData(data: Record<string, string>): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  return {
    async set(provider: string, key: string): Promise<void> {
      const data = readData();
      data[provider] = key;
      writeData(data);
    },

    async get(provider: string): Promise<string | null> {
      const data = readData();
      return data[provider] ?? null;
    },

    async clear(provider: string): Promise<void> {
      const data = readData();
      delete data[provider];
      writeData(data);
    },

    async status(): Promise<Record<string, boolean>> {
      const data = readData();
      return {
        openai: 'openai' in data,
        anthropic: 'anthropic' in data,
        gemini: 'gemini' in data,
      };
    },
  };
}

export { createCredentialManager, CredentialManager };