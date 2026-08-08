import * as fs from 'fs';
import * as path from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'harness-credential-salt';

interface CredentialManager {
  set(provider: string, key: string): Promise<void>;
  get(provider: string): Promise<string | null>;
  clear(provider: string): Promise<void>;
  status(): Promise<Record<string, boolean>>;
}

interface EncryptedEntry {
  encrypted: string;
  iv: string;
  tag: string;
}

interface EncryptedStore {
  encrypted: true;
  data: Record<string, EncryptedEntry>;
}

function encrypt(text: string, masterPassword: string): EncryptedEntry {
  const key = scryptSync(masterPassword, SALT, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { encrypted, iv: iv.toString('hex'), tag };
}

function decrypt(entry: EncryptedEntry, masterPassword: string): string | null {
  try {
    const key = scryptSync(masterPassword, SALT, 32);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(entry.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'hex'));
    let decrypted = decipher.update(entry.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

function createCredentialManager(storagePath: string, masterPassword?: string): CredentialManager {
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }

  const filePath = path.join(storagePath, 'credentials.json');

  if (!masterPassword) {
    console.warn(
      '[credential] 未提供 masterPassword，使用明文存储。生产环境请设置 HARNESS_MASTER_PASSWORD 环境变量。',
    );

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

  function readEncrypted(): EncryptedStore {
    if (!fs.existsSync(filePath)) {
      return { encrypted: true, data: {} };
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as EncryptedStore;
  }

  function writeEncrypted(store: EncryptedStore): void {
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  return {
    async set(provider: string, key: string): Promise<void> {
      const store = readEncrypted();
      store.data[provider] = encrypt(key, masterPassword);
      writeEncrypted(store);
    },

    async get(provider: string): Promise<string | null> {
      const store = readEncrypted();
      const entry = store.data[provider];
      if (!entry) return null;
      return decrypt(entry, masterPassword);
    },

    async clear(provider: string): Promise<void> {
      const store = readEncrypted();
      delete store.data[provider];
      writeEncrypted(store);
    },

    async status(): Promise<Record<string, boolean>> {
      const store = readEncrypted();
      return {
        openai: 'openai' in store.data,
        anthropic: 'anthropic' in store.data,
        gemini: 'gemini' in store.data,
      };
    },
  };
}

export { createCredentialManager, CredentialManager };