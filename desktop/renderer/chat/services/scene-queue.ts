import type { Attachment } from '../models/chat';
import type { MessageScene } from '../models/scenes';
export interface SavedSceneSend {
  id: string;
  endpoint: string;
  scene: MessageScene;
  text: string;
  files: Attachment[];
  createdAt: number;
  phase: 'queued' | 'sending';
}

/** Separate from history: these messages have not been acknowledged by Heart. */
export class SceneQueueStore {
  private database?: Promise<IDBDatabase>;
  private memory = new Map<string, SavedSceneSend>();
  constructor(readonly endpoint: string) {}
  private open() {
    return this.database ||= new Promise<IDBDatabase>((resolve, reject) => {
      const indexed = (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB;
      if (!indexed) { reject(new Error('indexedDB unavailable')); return; }
      const request = indexed.open('portal-scene-outbox', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('sends', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async read(): Promise<SavedSceneSend[]> {
    if (!(globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB)
      return [...this.memory.values()].filter(row => row.endpoint === this.endpoint).sort((a, b) => a.createdAt - b.createdAt);
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('sends').objectStore('sends').getAll();
      request.onsuccess = () => resolve((request.result as SavedSceneSend[])
        .filter(row => row.endpoint === this.endpoint).sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error);
    });
  }
  async write(row: SavedSceneSend | string) {
    if (!(globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB) {
      if (typeof row === 'string') this.memory.delete(row); else this.memory.set(row.id, row);
      return;
    }
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('sends', 'readwrite');
      const store = transaction.objectStore('sends');
      if (typeof row === 'string') store.delete(row); else store.put(row);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
  }
  close() { void this.database?.then(db => db.close()); this.memory.clear(); }
}
