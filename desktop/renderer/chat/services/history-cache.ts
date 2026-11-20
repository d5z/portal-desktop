import type { SceneSummary } from "./client-commands";
import { messageScene } from "../models/scenes";

// Store and restore all scenes together; only network pages have a display preference.
// Changing the visible scope never changes the cache cursor.
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

/** A history page is an upsert, never a replacement for the local transcript. */
export function mergeHistoryRow(previous: HistoryMessage | undefined, incoming: HistoryMessage): HistoryMessage {
  // An empty snapshot is not a deletion: retain the last readable copy.
  const row: HistoryMessage = { seq: Number(incoming.seq), role: incoming.role,
    content: incoming.content.trim() ? incoming.content : previous?.content || incoming.content };
  for (const key of ["at", "from", "type", "scene_id", "scene_label"] as const) {
    const value = key === "scene_label" ? messageScene(incoming).sceneLabel : incoming[key];
    // Older servers and partial snapshots can omit scene metadata. Do not move
    // a known row out of its scene index when merging such a response.
    if (typeof value === "string" && value) row[key] = value;
    else if (previous?.[key]) row[key] = previous[key];
  }
  return row;
}

export function normalizeHistoryRows(messages: unknown): HistoryMessage[] {
  const rows = new Map<number, HistoryMessage>();
  if (!Array.isArray(messages)) return [];
  for (const message of messages) {
    if (!message || !Number.isSafeInteger(Number(message.seq)) || Number(message.seq) <= 0 ||
        typeof message.content !== "string") continue;
    // Breath markers in the history protocol need not carry a chat role.
    const role = typeof message.role === "string" ? message.role
      : message.from === "system" || message.type === "marker" ? "system" : null;
    if (!role) continue;
    const row = mergeHistoryRow(rows.get(Number(message.seq)), { ...message, role });
    rows.set(row.seq, row);
  }
  return [...rows.values()].sort((a, b) => a.seq - b.seq);
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
        const request = indexedDB.open(this.name!, 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "seq" });
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
          const messages = request.transaction!.objectStore("messages");
          if (!messages.indexNames.contains("scene")) messages.createIndex("scene", "scene_id");
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

  async read(limit = Infinity): Promise<{ messages: HistoryMessage[]; lastSeq: number } | null> {
    try {
      const db = await this.open();
      if (!db || this.closed) return null;
      // Read messages and cursor from the same snapshot.
      const tx = db.transaction(["messages", "meta"], "readonly");
      const done = transactionDone(tx);
      void done.catch(() => {});
      const messages: HistoryMessage[] = [];
      let lastSeq: number | undefined;
      const meta = tx.objectStore("meta").get("state");
      meta.onsuccess = () => {
        const saved = meta.result?.lastSeq;
        if (Number.isSafeInteger(saved) && saved >= 0) lastSeq = saved;
      };
      const cursor = tx.objectStore("messages").openCursor(null, "prev");
      cursor.onsuccess = () => {
        if (!cursor.result || messages.length >= limit) return;
        messages.push(cursor.result.value);
        cursor.result.continue();
      };
      await done;
      if (!messages.length) return null;
      // Targeted reads can cache rows beyond the fully synchronized range.
      // Only legacy databases without metadata may infer a cursor from rows.
      return { messages: messages.reverse(), lastSeq: lastSeq ?? messages.reduce((seq, message) => Math.max(seq, message.seq), 0) };
    } catch { return null; }
  }

  /** Page backwards without moving the forward synchronization cursor. */
  async readBefore(before:number,limit:number,include:(message:HistoryMessage)=>boolean=()=>true):Promise<HistoryMessage[]> {
    try {
      const db=await this.open();if(!db || this.closed)return [];
      const tx=db.transaction('messages','readonly'),done=transactionDone(tx),messages:HistoryMessage[]=[];
      const cursor=tx.objectStore('messages').openCursor(Number.isFinite(before)?IDBKeyRange.upperBound(before,true):null,'prev');
      cursor.onsuccess=()=>{
        if(!cursor.result || messages.length>=limit)return;
        if(include(cursor.result.value))messages.push(cursor.result.value);
        cursor.result.continue();
      };
      await done;return messages.reverse();
    }catch{return [];}
  }

  /** Seek to a confirmed message and read only its nearby scene context. */
  async readAround(seq: number, sceneId: string, radius = 10): Promise<HistoryMessage[]> {
    try {
      const db = await this.open();
      if (!db || this.closed || !Number.isSafeInteger(seq) || seq <= 0 || !sceneId) return [];
      const tx = db.transaction('messages', 'readonly'), done = transactionDone(tx);
      const rows: HistoryMessage[] = [];
      for (const direction of ['prev', 'next'] as const) {
        let count = 0;
        const cursor = tx.objectStore('messages').index('scene').openCursor(IDBKeyRange.only(sceneId), direction);
        cursor.onsuccess = () => {
          if (!cursor.result || count >= radius + (direction === 'next' ? 1 : 0)) return;
          const row = cursor.result.value as HistoryMessage;
          if (direction === 'prev' && row.seq >= seq) { cursor.result.continuePrimaryKey(sceneId, seq - 1); return; }
          if (direction === 'next' && row.seq < seq) { cursor.result.continuePrimaryKey(sceneId, seq); return; }
          rows.push(row); count++;
          cursor.result.continue();
        };
      }
      await done;
      return rows.sort((a, b) => a.seq - b.seq);
    } catch { return []; }
  }

  /** Read every cached row in a room without changing the global sync cursor. */
  async readScene(sceneId: string, limit = Infinity): Promise<HistoryMessage[]> {
    try {
      const db = await this.open();
      if (!db || this.closed || !sceneId) return [];
      const tx = db.transaction("messages", "readonly");
      const done = transactionDone(tx);
      const messages: HistoryMessage[] = [];
      // Equal index keys are ordered by the primary key (seq).
      const cursor = tx.objectStore("messages").index("scene").openCursor(IDBKeyRange.only(sceneId), "prev");
      cursor.onsuccess = () => {
        if (!cursor.result || messages.length >= limit) return;
        messages.push(cursor.result.value);
        cursor.result.continue();
      };
      await done;
      return messages.reverse();
    } catch { return []; }
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

  /** Merge by identity before display, including cached rows outside the visible window. */
  async merge(messages: HistoryMessage[]): Promise<HistoryMessage[]> {
    if (!messages.length) return messages;
    try {
      const db = await this.open();
      if (!db || this.closed) return messages;
      const tx = db.transaction('messages', 'readonly');
      const done = transactionDone(tx);
      const merged = [...messages];
      for (let index = 0; index < messages.length; index++) {
        const request = tx.objectStore('messages').get(messages[index].seq);
        request.onsuccess = () => { merged[index] = mergeHistoryRow(request.result, messages[index]); };
      }
      await done;
      return merged;
    } catch { return messages; }
  }

  async write(messages: HistoryMessage[], cursor: number) {
    try {
      const db = await this.open();
      if (!db || this.closed) return;
      const rows = normalizeHistoryRows(messages);
      const tx = db.transaction(["messages", "meta"], "readwrite");
      const done = transactionDone(tx);
      void done.catch(() => {});
      const store = tx.objectStore("messages");
      for (const m of rows) {
        // Read/merge/write within one transaction; concurrent pages cannot
        // erase scene metadata or any row absent from the incoming page.
        const previous = store.get(m.seq);
        previous.onsuccess = () => store.put(mergeHistoryRow(previous.result, m));
      }
      const meta = tx.objectStore("meta");
      const previous = meta.get("state");
      previous.onsuccess = () => {
        if (Number.isSafeInteger(cursor) && cursor >= 0 && (!previous.result || cursor > (Number(previous.result.lastSeq) || 0))) {
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
