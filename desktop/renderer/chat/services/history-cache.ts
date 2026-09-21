import type { SceneSummary } from "./client-commands";
import { messageScene } from "../models/scenes";

// Store all scenes together; changing the visible scope never changes the cache cursor.
// Only server-confirmed history is stored; stream/tool state is not a backup.
export interface HistoryMessage {
  seq: number;
  role: string;
  content: string;
  at?: string;
  from?: string;
  type?: string;
  scene_id?: string;
  scene_label?: string;
}

export function historyCacheDatabaseName(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    // Credentials, query parameters, theme and frame revision are never identity.
    const scope = url.origin + url.pathname.replace(/\/+$/, "");
    return `loom-history-${encodeURIComponent(scope)}`;
  } catch {
    return null;
  }
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("History cache transaction failed"));
  });
}

export class HistoryCache {
  private database: IDBDatabase | null = null;
  private opening?: Promise<IDBDatabase | null>;
  private closed = false;
  private name: string | null;
  constructor(endpoint: string) {
    this.name = historyCacheDatabaseName(endpoint);
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.closed || !this.name || typeof indexedDB === "undefined") return Promise.resolve(null);
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve) => {
      let settled = false;
      const finish = (db: IDBDatabase | null) => {
        if (settled) { db?.close(); return; }
        settled = true;
        clearTimeout(timer);
        this.database = db;
        resolve(db);
      };
      const timer = setTimeout(() => finish(null), 1500);
      try {
        const request = indexedDB.open(this.name!, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "seq" });
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        };
        request.onsuccess = () => {
          const db = request.result;
          if (this.closed) { db.close(); finish(null); return; }
          db.onversionchange = () => this.close();
          finish(db);
        };
        request.onerror = () => finish(null);
        // A blocked open falls back to the network after the timeout.
      } catch { finish(null); }
    });
    return this.opening;
  }

  async read(limit = 300): Promise<{ messages: HistoryMessage[]; lastSeq: number } | null> {
    try {
      const db = await this.open();
      if (!db || this.closed) return null;
      // Read messages and cursor from the same snapshot.
      const tx = db.transaction(["messages", "meta"], "readonly");
      const done = transactionDone(tx);
      void done.catch(() => {});
      const messages: HistoryMessage[] = [];
      let lastSeq = 0;
      const meta = tx.objectStore("meta").get("state");
      meta.onsuccess = () => { lastSeq = Number(meta.result?.lastSeq) || 0; };
      const cursor = tx.objectStore("messages").openCursor(null, "prev");
      cursor.onsuccess = () => {
        if (!cursor.result || messages.length >= limit) return;
        messages.push(cursor.result.value);
        cursor.result.continue();
      };
      await done;
      if (!messages.length) return null;
      return { messages: messages.reverse(), lastSeq: Math.max(lastSeq, ...messages.map(m => m.seq)) };
    } catch { return null; }
  }

  // Scan the complete cache, not the 300-message visible window. Exact scene
  // equality deliberately excludes legacy/unaddressed messages from @context.
  private async scan(visit: (message: HistoryMessage) => boolean): Promise<void> {
    const db = await this.open();
    if (!db || this.closed) throw new Error("Local history cache unavailable");
    const tx = db.transaction("messages", "readonly");
    const done = transactionDone(tx);
    const request = tx.objectStore("messages").openCursor(null, "prev");
    request.onsuccess = () => {
      if (request.result && visit(request.result.value)) request.result.continue();
    };
    await done;
  }

  async context(sceneId: string, limit = 50): Promise<HistoryMessage[]> {
    const messages: HistoryMessage[] = [];
    await this.scan(message => {
      if (message.scene_id === sceneId) messages.push(message);
      return messages.length < Math.max(1, Math.min(limit, 50));
    });
    return messages.reverse();
  }

  async scenes(): Promise<SceneSummary[]> {
    const scenes = new Map<string, SceneSummary>();
    await this.scan(message => {
      if (!message.scene_id) return true;
      const scene = scenes.get(message.scene_id) || { sceneId: message.scene_id, messageCount: 0 };
      scene.messageCount++;
      if (!scene.label && message.scene_label) scene.label = message.scene_label;
      if (message.at && (!scene.lastActive || message.at > scene.lastActive)) scene.lastActive = message.at;
      scenes.set(scene.sceneId, scene);
      return true;
    });
    return [...scenes.values()];
  }

  async write(messages: HistoryMessage[], cursor: number) {
    try {
      const db = await this.open();
      if (!db || this.closed) return;
      const rows = messages.filter(m => Number.isSafeInteger(Number(m.seq)) && Number(m.seq) > 0
        && typeof m.content === "string" && typeof m.role === "string");
      const tx = db.transaction(["messages", "meta"], "readwrite");
      const done = transactionDone(tx);
      void done.catch(() => {});
      const store = tx.objectStore("messages");
      for (const m of rows) {
        // Allowlist fields: no tokens, attachment bytes or transient UI objects.
        const row: HistoryMessage = { seq: Number(m.seq), role: m.role, content: m.content };
        for (const key of ["at", "from", "type", "scene_id"] as const) {
          if (typeof m[key] === "string") row[key] = m[key];
        }
        const scene = messageScene(m);
        if (scene.sceneLabel) row.scene_label = scene.sceneLabel;
        store.put(row);
      }
      const meta = tx.objectStore("meta");
      const previous = meta.get("state");
      previous.onsuccess = () => {
        if (Number.isSafeInteger(cursor) && cursor > (Number(previous.result?.lastSeq) || 0)) {
          meta.put({ key: "state", lastSeq: cursor, updatedAt: new Date().toISOString() });
        }
      };
      await done;
    } catch {
      // Private browsing/quota errors must not break chat or advance a disk cursor.
    }
  }

  close() {
    this.closed = true;
    this.database?.close();
    this.database = null;
  }
}
