/* Lưu nháp form của Modal vào IndexedDB để tự động fill lại khi mở lại.
   Dùng thư viện `idb` (đã có sẵn). DB riêng, không đụng store khác. */
import { openDB } from "idb";

const DB_NAME = "erp-modal-drafts";
const STORE = "drafts";

async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });
}

export async function getModalDraft<T>(key: string): Promise<T | null> {
  try {
    const db = await getDb();
    return (await db.get(STORE, key)) ?? null;
  } catch {
    return null;
  }
}

export async function setModalDraft<T>(key: string, value: T): Promise<void> {
  try {
    const db = await getDb();
    await db.put(STORE, value, key);
  } catch {
    /* IDB unavailable — bỏ qua, không vỡ form */
  }
}

export async function clearModalDraft(key: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE, key);
  } catch {
    /* ignore */
  }
}
