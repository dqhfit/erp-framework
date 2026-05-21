import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "erp-framework";
const VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await getDB();
    return db.get(STORE, key) as Promise<T | undefined>;
  },
  async set(key: string, val: unknown): Promise<void> {
    const db = await getDB();
    await db.put(STORE, val, key);
  },
  async del(key: string): Promise<void> {
    const db = await getDB();
    await db.delete(STORE, key);
  },
  async keys(): Promise<string[]> {
    const db = await getDB();
    return (await db.getAllKeys(STORE)) as string[];
  },
};
