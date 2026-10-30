import {attachmentTimeline} from './attachment-timeline';
import { prepareAttachments } from './attachments';
import { AttachmentMessages, attachmentMessageReader, releaseAttachmentMessageReader, messageReferences } from './attachment-messages';
import { SceneQueueStore } from "./scene-queue";
import type { SavedSceneSend } from "./scene-queue";
import { inCurrentScene, messageScene, stripSceneTransition, withSceneTransition } from "../models/scenes";
import type { ChatRuntime, ChatState, RuntimeOptions } from "../models/chat";

/** One Being coordinator; scene-local state is not a separate agent or breath. */
export function createSceneRuntime(state: ChatState, options: RuntimeOptions, createRuntime: any): ChatRuntime {
  const sessions = new Map<any, any>();
  const restoredHistory = new WeakSet<object>();
  let selected: any, owner: any, disposed = false, counter = 0;
  let lastActivity = "";
  let historyRefreshes = 0;
  let initializing = true, sceneLoads = 0;
  function updateHistoryLoading() {
    if (disposed) return;
    state.historyLoading = initializing || sceneLoads > 0;
    state.changed();
  }
  const sendQueue: any[] = [];
  let drainScheduled = false, dispatching = false;
  let submission = Promise.resolve();
  let queueReady = false, drainTimer: any;
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  let activityInFlight = false, coordinatorStarted = false;
  async function syncActivity() {
    if (disposed || activityInFlight) return;
    activityInFlight = true;
    const snapshots = [...sessions.values()].map(session => [session, session.runtime.captureActivity?.()] as const);
    try {
      const response = await owner.runtime.request('/api/stream/active', {cache: 'no-store', signal: AbortSignal.timeout(8000)});
      if (disposed || (!response.ok && response.status !== 204)) return;
      const active = response.status === 204 ? null : await response.json();
      // Malformed/failed responses are not evidence that the server is idle.
      if (response.status !== 204 && (!active || typeof active.stream_id !== 'string' || !active.stream_id || typeof active.finished !== 'boolean')) return;
      if (disposed) return;
      for (const [session, snapshot] of snapshots) {
        if (disposed) return;
        if (snapshot) await session.runtime.reconcileActivity(active, snapshot);
      }
      if (disposed) return;
      if (active) owner.runtime.discoverActiveStream?.(active);
      // Short autonomous breaths may finish between polls; their history still
      // needs to appear without a focus change or manual refresh.
      await owner.runtime.reconcileHistory?.({preserve: true});
      for (const session of sessions.values()) session.runtime.settleHistoryReply?.();
      publish();
    } catch { /* A failed observation must not clear valid work. Retry below. */ }
    finally {
      activityInFlight = false;
      if (!disposed) activityTimer = setTimeout(syncActivity, 10000);

    }
  }
  const pageLocation = typeof location === 'undefined' ? { search: '', origin: '' } : location;
  const queueStore = new SceneQueueStore(new URLSearchParams(pageLocation.search).get('history_scope') || pageLocation.origin);
  const attachmentLifetime = new AbortController();
  const desktopAttachments = typeof location !== 'undefined' && location.protocol === 'beings:';
  let attachmentPoll: ReturnType<typeof setTimeout> | undefined;
  let attachmentSyncing = false;
  function attachmentRequest(sceneId?: string, signal = attachmentLifetime.signal) {
    return (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('X-Portal-Being-Endpoint', queueStore.endpoint);
      if (sceneId) headers.set('X-Portal-Scene-Id', sceneId);
      return globalThis.fetch('beings://chat' + path, {...init, headers, signal: AbortSignal.any([signal, attachmentLifetime.signal, AbortSignal.timeout(path.startsWith('/api/attachments?') ? 330000 : 60000)])});
    };
  }
  const messageViews = attachmentMessageReader(queueStore.endpoint, attachmentRequest());
  let attachmentDiscoveryAt=0, attachmentSignature='';
  const externallyActive = () => state.items.filter((item:any)=>item.kind==='message' && !item.queued && item.sceneId===state.currentScene.sceneId).flatMap((item:any)=>item.attachmentViews || []).filter((view:any)=>!['failed','cancelled'].includes(view.delivery_status) && view.parts.some((part:any)=>part.type==='attachment' && ['receiving','uploaded','parsing'].includes(part.parse_status)));
  async function syncAttachmentViews(discover=false) {
    if (!desktopAttachments || disposed || attachmentSyncing) return;
    clearTimeout(attachmentPoll);
    attachmentSyncing = true;
    try {
      const pending = discover && Date.now()-attachmentDiscoveryAt>60000 ? await messageViews.list().catch(()=>[]) : [];
      if(discover)attachmentDiscoveryAt=Date.now();
      const refreshIds=new Set(externallyActive().map((view:any)=>view.message_id));
      if (disposed) return;
      for (const view of pending) {
        const represented = state.items.some((item: any) => item.kind === 'message' && item.role === 'user' &&
          (item.attachmentViews?.some((v: any) => v.message_id === view.message_id) || messageReferences(item.text).includes(view.message_id)));
        if (!represented) state.items.push({kind:'message', id:'attachment-' + view.message_id, role:'user', text:'', streaming:false,
          timestamp:new Date(view.created_at * 1000).toLocaleTimeString(), createdAt:view.created_at * 1000, label:view.channel === 'portal' ? 'you' : view.channel,
          consecutive:false, sceneId:view.scene_id, sceneLabel:view.scene_label, attachmentViews:[view], attachmentEndpoint:queueStore.endpoint});
      }
      state.items = attachmentTimeline(state.items);
      // Resolve accepted rows by stable history references, independently of pending.
      for (const item of [...state.items]) {
        if (item.kind !== 'message' || item.role !== 'user') continue;
        const ids = messageReferences(item.text);
        const wanted = ids.length ? ids : item.attachmentViews?.map(v => v.message_id) || [];
        if (!wanted.length) continue;
        const views = await Promise.all(wanted.map(id => messageViews.get(id, !pending.some(view=>view.message_id===id) && refreshIds.has(id)))).catch(()=>null);
        if (!views) continue;
        if (disposed) return;
        if (item.historySeq) for (let index = 0; index < views.length; index++) {
          const view = views[index];
          if (view.channel !== 'portal' || view.delivery_status === 'accepted' || view.delivery_status === 'cancelled' ||
              item.sceneId !== view.scene_id || !sessions.has(view.scene_id)) continue;
          try {
            views[index] = await new AttachmentMessages(attachmentRequest(view.scene_id)).update(view.message_id, {delivery_status:'accepted'});
            messageViews.cache.set(view.message_id, views[index]);
          } catch { /* History is retained even if the status update is unavailable. */ }
        }
        item.attachmentViews = views; item.attachmentEndpoint = queueStore.endpoint;
        if (views[0]?.channel !== 'portal') item.label = views[0].channel;
        if (!item.sceneId && views[0]) { item.sceneId = views[0].scene_id; item.sceneLabel = views[0].scene_label; }
        if (item.historySeq) {
          state.items = state.items.filter((other: any) => other === item || other.kind !== 'message' || other.historySeq || other.queued ||
            !other.attachmentViews?.some((v: any) => ids.includes(v.message_id)));
        }
      }
      for (const queued of [...sendQueue]) {
        if (!queued.saved.attachment || queued.claimed || !restoredSendWasAccepted(queued)) continue;
        detachQueued(queued);
        state.items = state.items.filter(item => item !== queued.entry.message || (item.kind === 'message' && !!item.historySeq));
        await queueStore.write(queued.saved.id);
      }
      publish();
    } catch { /* Unavailable service must not break ordinary chat/history. */ }
    finally { attachmentSyncing = false; if (!disposed && externallyActive().length) attachmentPoll = setTimeout(()=>void syncAttachmentViews(), 10000); }
  }
  let queueStoreClosed = false;
  function closeQueueStore() {
    if (queueStoreClosed) return;
    queueStoreClosed = true;
    queueStore.close();
  }
  function retryDrain() {
    if (!disposed && !drainTimer) drainTimer = setTimeout(() => { drainTimer = null; scheduleDrain(); }, 2000);
  }
  function attachQueued(target: any, entry: any, saved: any, persisted = true) {
    const queued = { session: target, entry, saved, persisted, claimed: false, cancelled: false, controller: new AbortController() };
    if (saved.attachment?.messageId) entry.message.attachmentEndpoint = queueStore.endpoint;
    sendQueue.push(queued);
    entry.message.canInterruptQueued = persisted && saved.phase === "queued" && !saved.attachment;
    target.local.queued++;
    entry.message.queueNotice = saved.phase === 'sending' ? '发送状态待确认，请先查看场景历史；不会自动重发' : undefined;
    entry.message.editQueued = async (text: string) => {
      if (queued.claimed || saved.phase !== 'queued' || saved.attachment || !sendQueue.includes(queued)) return;
      const nextText = String(text || '').trim();
      if (!nextText) return;
      entry.text = nextText;
      entry.message.text = nextText;
      saved.text = nextText;
      try { await queueStore.write(saved); publish(); }
      catch { entry.message.queueNotice = '无法保存编辑，请重试'; publish(); }
    };
    entry.message.moveQueued = async (offset: number) => {
      const peers = sendQueue.filter(item => item.session === queued.session);
      const destination = Math.max(0, Math.min(peers.length - 1, peers.indexOf(queued) + (offset < 0 ? -1 : 1)));
      await entry.message.reorderQueued?.(peers[destination]?.entry.message.id || '');
    };
    entry.message.reorderQueued = async (targetId: string) => {
      if (queued.claimed || saved.phase !== 'queued' || !sendQueue.includes(queued)) return;
      const current = sendQueue.indexOf(queued);
      const peers = sendQueue.filter(item => item.session === queued.session);
      const peerIndex = peers.indexOf(queued), destination = peers.findIndex(item => item.entry.message.id === targetId);
      if (destination < 0) return;
      if (destination === peerIndex) return;
      const other = peers[destination];
      const movingDown = peerIndex < destination;
      sendQueue.splice(current, 1);
      const targetIndex = sendQueue.indexOf(other) + (movingDown ? 1 : 0);
      sendQueue.splice(targetIndex, 0, queued);
      // The composer derives its rows from state.items, so mirror the queue
      // order there while leaving history and other scenes untouched.
      const queueItems = state.items.filter((item: any) => sendQueue.some(candidate => candidate.entry.message === item));
      const ordered = sendQueue.filter(item => item.session === queued.session).map(item => item.entry.message);
      const sceneQueueItems = queueItems.filter((item: any) => ordered.includes(item));
      if (sceneQueueItems.length) {
        let cursor = 0;
        state.items = state.items.map((item: any) => sceneQueueItems.includes(item) ? ordered[cursor++] : item);
      }
      try {
        await Promise.all(sendQueue.map((item, index) => { item.saved.order = index; return queueStore.write(item.saved); }));
        publish(); scheduleDrain();
      } catch { entry.message.queueNotice = '无法保存排序，请重试'; publish(); }
    };
    entry.message.cancelQueued = async () => {
      if (queued.claimed && (!saved.attachment || saved.phase === 'sending')) return;
      queued.cancelled = true;
      queued.controller.abort();
      queued.claimed = true;
      if (saved.attachment?.messageId) {
        try { await new AttachmentMessages(attachmentRequest(saved.scene.sceneId)).update(saved.attachment.messageId, {delivery_status:'cancelled'}); }
        catch { entry.message.queueNotice = '本地已取消；服务端状态尚未同步'; }
      }
      try { await queueStore.write(saved.id); }
      catch { queued.claimed = false; entry.message.queueNotice = '无法保存取消操作，请重试'; publish(); return; }
      const index = sendQueue.indexOf(queued);
      if (index < 0) return;
      detachQueued(queued);
      state.items = state.items.filter((item: any) => item !== entry.message);
      publish();
    };
    entry.message.interruptQueued = () => {
      submission = submission.then(async () => {
        if (disposed || queued.claimed || !sendQueue.includes(queued) || !queued.persisted || saved.phase !== 'queued' || saved.attachment) return;
        if ([...sessions.values()].some(other => other !== target && busy(other))) return;
        queued.claimed = true;
        try {
          saved.createdAt = Date.now();
          await queueStore.write({ ...saved, phase: 'sending' });
          if (disposed || [...sessions.values()].some(other => other !== target && busy(other))) { await queueStore.write(saved); return; }
          saved.phase = 'sending';
          detachQueued(queued, true);
          // The server's existing splice/yield path interrupts this scene with
          // the new input; do not stop a different scene's stream.
          void Promise.resolve(target.runtime.send(entry.text, entry.files, { ...entry.sendOptions, queuedMessage: entry.message }))
            .then(() => { if (!disposed) return queueStore.write(saved.id); })
            .catch(() => { /* Keep the durable uncertain record for reconciliation. */ });
        } catch {
          entry.message.queueNotice = '无法保存发送状态，请重试';
        } finally { queued.claimed = false; publish(); }
      });
      return submission;
    };
    return queued;
  }
  function detachQueued(queued: any, sent = false) {
    const index = sendQueue.indexOf(queued);
    if (index < 0) return false;
    sendQueue.splice(index, 1);
    queued.session.local.queued = Math.max(0, queued.session.local.queued - 1);
    if (sent) {
      state.items = [...state.items.filter((item: any) => item !== queued.entry.message), queued.entry.message];
      queued.entry.message.createdAt = queued.saved.createdAt;
      queued.entry.message.queued = false;
      queued.entry.message.cancelQueued = undefined;
      queued.entry.message.interruptQueued = undefined;
      queued.entry.message.queueNotice = undefined;
    }
    return true;
  }
  function restoredSendWasAccepted(queued: any) {
    if (queued.saved.attachment?.messageId) return state.items.some((item: any) => item.kind === 'message' && item.role === 'user' && item.historySeq && messageReferences(item.text).includes(queued.saved.attachment.messageId));
    if (queued.saved.phase !== 'sending') return false;
    const expected = stripSceneTransition(queued.saved.text || '').replace(/\s+/g, ' ').trim();
    if (!expected) return false;
    return state.items.some((item: any) => {
      if (item.kind !== 'message' || item.role !== 'user' || !item.historySeq || item === queued.entry.message) return false;
      const actual = stripSceneTransition(item.text || '').replace(/\s+/g, ' ').trim();
      if (actual !== expected || !inCurrentScene(item, queued.saved.scene) || !inCurrentScene(queued.saved.scene, item)) return false;
      const sentAt = Number(queued.saved.createdAt), acceptedAt = Number(item.createdAt);
      return Number.isFinite(sentAt) && Number.isFinite(acceptedAt) && Math.abs(sentAt - acceptedAt) <= 2 * 60 * 1000;
    });
  }
  // Presentation also includes completed delegated tasks awaiting a summary.
  // Only runtime ownership can block sending; those ledger rows hold no stream.
  const busy = (session: any) => typeof session.runtime?.isBusy === "function"
    ? session.runtime.isBusy()
    : ["thinking", "replying", "working", "waiting", "reconnecting"].includes(session.runtime?.sceneActivity());
  async function queuedSave(next: any) {
    if (next.cancelled) throw new DOMException('已取消附件发送', 'AbortError');
    await queueStore.write(next.saved);
  }
  function scheduleDrain() {
    if (disposed || !queueReady || drainTimer || drainScheduled || dispatching || !sendQueue.length) return;
    drainScheduled = true;
    queueMicrotask(async () => {
      drainScheduled = false;
      if (disposed || dispatching || [...sessions.values()].some(busy)) { retryDrain(); return; }
      const next = sendQueue.find(next => next.saved.phase !== 'failed');
      if (!next || next.claimed || ['sending','failed'].includes(next.saved.phase) || !next.persisted) return;
      next.claimed = true;
      dispatching = true;
      try {
        // Refresh can erase local activity flags; check the actual breath first.
        const response = await owner.runtime.request('/api/stream/active', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (response.status !== 204) {
          if (!response.ok) { retryDrain(); return; }
          const active = await response.json();
          if (!active.finished && (!active.origin || active.origin === 'human')) { retryDrain(); return; }
        }
        if (disposed || next.cancelled || [...sessions.values()].some(busy)) { retryDrain(); return; }
        if (next.saved.attachment) {
          next.saved.phase = 'preparing'; await queuedSave(next);
          const request = attachmentRequest(next.saved.scene.sceneId, next.controller.signal);
          const views = new AttachmentMessages(request);
          const save = () => queuedSave(next);
          const show = (view: any) => {
            if (disposed) return;
            state.items = state.items.filter((item: any) => item === next.entry.message || item.id !== 'attachment-' + view.message_id);
            messageViews.cache.set(view.message_id,view);
            next.entry.message.attachmentViews = [view]; next.entry.message.attachmentEndpoint = queueStore.endpoint;
            next.entry.message.queueNotice = view.delivery_status === 'pending' ? '附件处理中，完成后发送' : undefined; publish();
          };
          const context = await prepareAttachments({key:next.saved.id, text:next.saved.text, files:next.saved.files,
            sceneId:next.saved.scene.sceneId!, sceneLabel:next.saved.scene.sceneLabel, transfer:next.saved.attachment,
            request, signal:next.controller.signal, save, show, progress: (file, value) => {
              next.entry.message.attachmentUploads ||= next.saved.files.map((f: any) => ({name:f.name,size:f.size,mime:f.type,blob:f.blob,progress:f.uploadProgress || (f.attachmentId ? {phase:'complete',loaded:f.size,total:f.size} : undefined)}));
              next.entry.message.attachmentUploads[next.saved.files.indexOf(file)].progress = value; publish();
            }});
          if (disposed || next.cancelled) return;
          // Another scene can start while parsing. Retain the prepared identifiers and wait.
          if ([...sessions.values()].some(busy)) { next.saved.phase = 'queued'; await save(); retryDrain(); return; }
          await next.session.runtime.send(next.entry.text || `[发送了 ${next.entry.files.length} 个文件]`, [], {
            ...next.entry.sendOptions, queuedMessage:next.entry.message, requestMessage:context,
            attachmentDelivery: async (status: string) => {
              if (status === 'sending') {
                next.controller.signal.throwIfAborted();
                next.saved.phase = 'sending'; next.saved.attachment.delivery = 'sending'; await save();
                show(await views.update(next.saved.attachment.messageId!, {delivery_status:'sending'}));
                next.entry.message.queued = false;
              } else {
                next.saved.attachment.delivery = status;
                if (status === 'accepted' || status === 'unknown') detachQueued(next, true);
                else { next.saved.phase = 'failed'; next.entry.message.queued = true; }
                try { await save(); show(await views.update(next.saved.attachment.messageId!, {delivery_status:status})); }
                catch { next.entry.message.queueNotice = '发送状态尚未同步，请核对历史'; }
              }
            },
          });
          if (!disposed && next.saved.attachment.delivery === 'failed') throw new Error('附件消息未被接受，请重试或取消');
          if (!disposed && next.saved.attachment.delivery === 'accepted') await queueStore.write(next.saved.id);
          else if (!disposed) {
            detachQueued(next, true);
            next.entry.message.queueNotice = '发送结果待确认，请核对历史；不会自动重发';
          }
          return;
        }
        next.saved.createdAt = Date.now();
        await queueStore.write({ ...next.saved, phase: 'sending' });
        next.saved.phase = 'sending';
        if (disposed || [...sessions.values()].some(busy)) {
          // Storage yields to other submissions. Recheck ownership before send
          // and restore the retryable row if another turn or disposal won.
          next.saved.phase = 'queued';
          try { await queueStore.write(next.saved); } catch { /* The next load keeps the conservative sending row. */ }
          retryDrain();
          return;
        }
        detachQueued(next, true);
        await next.session.runtime.send(next.entry.text, next.entry.files, { ...next.entry.sendOptions, queuedMessage: next.entry.message });
        // If refresh interrupts the request, retain the uncertain record instead
        // of risking a duplicate send on the next page load.
        if (!disposed) await queueStore.write(next.saved.id);
      } catch (error) {
        if (next.saved.attachment && !disposed && !next.cancelled) {
          next.saved.phase = next.saved.attachment.delivery === 'sending' || next.saved.attachment.delivery === 'unknown' ? 'sending' : 'failed';
          try { await queueStore.write(next.saved); } catch { /* Keep existing conservative checkpoint. */ }
          next.entry.message.queueNotice = error instanceof Error ? error.message : '附件处理失败';
          next.entry.message.retryLabel = '重试附件处理';
          if (next.saved.phase === 'failed') next.entry.message.retry = async () => {
            for (const file of next.saved.files) if (file.parseFailed) { file.jobId = undefined; file.forceParse = true; file.parseFailed = false; }
            next.saved.phase = 'queued'; await queueStore.write(next.saved);
            next.entry.message.retry = undefined; next.entry.message.queueNotice = undefined; scheduleDrain(); publish();
          };
        } else if (sendQueue.includes(next)) { next.entry.message.queueNotice = '等待连接或本地存储恢复'; retryDrain(); }
      } finally {
        next.claimed = false;
        dispatching = false;
        if (disposed) closeQueueStore();
        publish();
      }
    });
  }
  const localKeys = new Set<PropertyKey>(["currentScene", "activeScene", "draft", "files", "queued", "thinking", "streaming", "stopping", "dotClass"]);
  const sceneStatus = (session: any) => {
    const status = session.runtime?.sceneActivity();
    const queued = sendQueue.some(next => next.session === session && next.saved.phase !== 'failed');
    const failed = sendQueue.some(next => next.session === session && next.saved.phase === 'failed');
    const tasks = (state.sceneTasks || []).filter((t: any) => t.sceneId === session.local.currentScene.sceneId);
    if (tasks.some((t: any) => t.status === 'running' || t.status === 'queued')) return 'working';
    if (status === 'error' || status === 'timeout' || status === 'stopped') return queued ? 'queued' : status;
    // Creation order is not completion order: an earlier slow task can finish
    // after a stage reply for a later fast task. Inspect every pending result.
    const currentTasks = tasks.filter((t: any) => !session.submittedAt || t.createdAt >= session.submittedAt);
    const repliedAt = session.runtime?.replyCompletedAt?.() || 0;
    if (!['thinking','replying'].includes(status)) {
      if (session.submittedAt && currentTasks.some((t: any) => t.status === 'done' && t.endedAt > repliedAt)) return 'waiting';
      if (currentTasks.some((t: any) => ['failed','interrupted','budget_exhausted','timeout'].includes(t.status) &&
          (!t.endedAt || t.endedAt > repliedAt))) return 'error';
    }
    return status && ["queued", "thinking", "replying", "working", "waiting", "reconnecting"].includes(status) ? status :
      queued ? "queued" : failed ? "error" : status;
  };
  function publish() {
    if (disposed || !selected) return;
    for (const key of localKeys) {
      if (key !== "currentScene" && key !== "draft") (state as any)[key] = selected.local[key];
    }
    if (state.items) state.items = attachmentTimeline(state.items);
    // Transcript scope never changes which scene the composer can stop.
    state.streaming = selected.runtime?.isSceneStreaming?.() ?? selected.local.streaming;
    const autonomous = [...sessions.values()].find(session => session.runtime?.activeAutonomousOrigin?.());
    state.sbsStreamingOrigin = autonomous?.runtime?.activeAutonomousOrigin?.();
    state.sbsActivityPhase = autonomous?.runtime?.autonomousPhase?.();
    state.attachmentPending = sendQueue.some(next => next.session === selected && next.saved.attachment && !['sending','failed'].includes(next.saved.phase));
    state.sendWillQueue = sendQueue.some(next => next.saved.phase !== 'failed') || [...sessions.values()].some(busy);
    state.canInterruptQueue = ![...sessions.values()].some(session => session !== selected && busy(session));
    const activity = Object.fromEntries([...sessions.entries()].flatMap(([id, session]) => {
      const status = sceneStatus(session);
      return id && status ? [[id, status]] : [];
    }));
    const signature = JSON.stringify(activity);
    if (signature !== lastActivity) {
      lastActivity = signature;
      options.onSceneActivity?.(activity);
    }
    const references=(state.items || []).filter((item:any)=>item.kind==='message').flatMap((item:any)=>messageReferences(item.text)).join(',');
    if(desktopAttachments && queueReady && references!==attachmentSignature){attachmentSignature=references;queueMicrotask(()=>void syncAttachmentViews());}
    state.changed();
    scheduleDrain();
  }
  function sessionFor(scene: any) {
    let session = sessions.get(scene.sceneId);
    if (session) return session;
    const local: any = { currentScene: { ...scene }, activeScene: { ...scene }, draft: "", files: [], queued: 0,
      thinking: false, streaming: false, stopping: false, dotClass: state.dotClass };
    const routed = new Set<any>();
    const proxy = new Proxy(state, {
      get(target, key) {
        if (key === "changed") return publish;
        if (key === "draft" && selected === session) return state.draft;
        return localKeys.has(key) ? local[key] : (target as any)[key];
      },
      set(target, key, value) {
        if (localKeys.has(key)) {
          local[key] = value;
          if (key === "draft" && selected === session) state.draft = value;
        } else (target as any)[key] = value;
        return true;
      },
    });
    session = { local, runtime: null };
    sessions.set(scene.sceneId, session);
    session.runtime = createRuntime(proxy, {
      ...options,
      nextId: () => ++counter,
      resolveDefaultScene(scene: any) {
        if (local.currentScene.sceneId || !scene.sceneId) return;
        // Resolve the existing room in place so replies carrying the new Loom
        // identity do not create a second, background session.
        sessions.delete(local.currentScene.sceneId);
        local.currentScene = { ...scene };
        local.activeScene = { ...scene };
        sessions.set(scene.sceneId, session);
        if (selected === session) state.currentScene = { ...scene };
      },
      prepareMessage(text: any) {
        // Track submission without changing the editable or locally rendered body.
        session.submittedAt = Date.now();
        return text;
      },
      prepareRequestMessage(text: any, scene: any, sendOptions: any = {}) {
        const previous = [...state.items].reverse().find(item =>
          item !== sendOptions.queuedMessage && item.kind === "message" &&
          (item.role === "user" || item.role === "being") && !item.queued);
        return withSceneTransition(text, scene, previous);
      },
      onConnection(next: any) {
        for (const other of sessions.values()) if (other !== session) other.runtime?.syncConnection(next);
        options.onConnection?.(next);
      },
      recoverScenes: async (details: any) => {
        if (session !== owner) return;
        await Promise.all([...sessions.values()].filter(s => s !== owner).map(s => s.runtime.recoverConnection(details)));
      },
      historyOwner: () => owner && owner !== session ? owner.runtime : null,
      selectedScene: () => state.currentScene,
      activeAutonomousOrigin: () => [...sessions.values()].map(s => s.runtime?.activeAutonomousOrigin?.()).find(Boolean),
      restoredHistory,
      onStopMarker(marker: any) {
        for (const target of sessions.values()) target.runtime?.acceptStopMarker?.(marker);
      },
      routeEvent(type: any, data: any, settled = false) {
        if (!Object.hasOwn(data, "scene_id")) return false;
        const scene = messageScene(data);
        if (scene.sceneId === local.currentScene.sceneId ||
            (scene.sceneId && local.currentScene.legacySceneId && inCurrentScene(scene, local.currentScene))) return false;
        const target = sessionFor(scene);
        routed.add(target);
        target.runtime.acceptSceneEvent(type, data, settled);
        return true;
      },
      finishRoutes() {
        for (const target of routed) target.runtime.finishRoutedStream();
        routed.clear();
      },
      routeReplay(data: any) {
        if (data.stream_id && [...sessions.values()].some(s => s !== session && s.runtime?.hasStream(data.stream_id))) return true;
        if (!Object.hasOwn(data, "scene_id")) return false;
        const scene = messageScene(data);
        if (scene.sceneId === local.currentScene.sceneId ||
            (scene.sceneId && local.currentScene.legacySceneId && inCurrentScene(scene, local.currentScene))) return false;
        sessionFor(scene).runtime.acceptReplay(data);
        return true;
      },
    });
    if (owner) session.runtime.syncConnection(state.connection);
    return session;
  }
  owner = selected = sessionFor(state.currentScene);
  selected.local.draft = state.draft;
  let selection = Promise.resolve();
  const runtime: any = {
    updateSceneTasks(tasks: any, subagentReady = state.subagentReady) {
      state.subagentReady = subagentReady === true;
      state.sceneTasks = tasks;
      for (const task of tasks) sessionFor({ sceneId: task.sceneId, sceneLabel: state.sceneNames?.[task.sceneId] || '' });
      publish();
    },
    async start() {
      if (coordinatorStarted || disposed) return;
      coordinatorStarted = true;
      try {
        const saved = await queueStore.read();
        if (disposed) return;
        for (const row of saved) {
          const target = sessionFor(row.scene);
          const entry = target.runtime.stageQueuedSend(row.text, row.files, row.sendOptions);
          if (entry) {
            entry.message.createdAt = row.createdAt;
            if (row.attachment) entry.message.attachmentUploads = row.files.map(f => ({name:f.name,size:f.size,mime:f.type,blob:f.blob,progress:f.uploadProgress || (f.attachmentId ? {phase:'complete',loaded:f.size,total:f.size} : undefined)}));
            if (row.attachment?.messageId) {
              try { entry.message.attachmentViews = [await messageViews.get(row.attachment.messageId, true)]; entry.message.attachmentEndpoint = queueStore.endpoint; } catch { /* Retain row for retry. */ }
            }
            if (row.phase === 'preparing') row.phase = 'queued';
            attachQueued(target, entry, row);
            if (row.phase === 'failed') {
              entry.message.queueNotice = '上次附件处理失败，请重试或取消';
              entry.message.retryLabel = '重试附件处理';
              entry.message.retry = async () => {
                for (const file of row.files) if (file.parseFailed) { file.jobId = undefined; file.forceParse = true; file.parseFailed = false; }
                row.phase = 'queued'; await queueStore.write(row); entry.message.retry = undefined; scheduleDrain(); publish();
              };
            }
          }
        }
        await owner.runtime.start();
        for (const queued of [...sendQueue]) {
          if (!restoredSendWasAccepted(queued)) continue;
          detachQueued(queued);
          state.items = state.items.filter((item: any) => item !== queued.entry.message || !!item.historySeq);
          try { await queueStore.write(queued.saved.id); } catch { /* Reconciliation will retry after the next load. */ }
        }
        queueReady = true;
      } catch {
        state.items.push({ kind: 'message', id: `queue-error-${++counter}`, role: 'system', text: '无法恢复本地排队记录，已暂停自动发送。请重新打开页面重试。', streaming: false, timestamp: '', label: 'system', consecutive: false, ...state.currentScene });
        await owner.runtime.start();
      } finally {
        initializing = false;
        updateHistoryLoading();
      }
      publish();
      if (!disposed) activityTimer = setTimeout(syncActivity, 10000);
      if (!disposed && desktopAttachments) void syncAttachmentViews(true);
    },
    send(...args: any[]) {
      const target = selected;
      args[2] = { intelligentUI: state.intelligentUIEnabled && state.intelligentUIForMessage,
        uiSnapshot: state.intelligentUISnapshots?.[state.currentScene.sceneId || 'global'] ?? '', ...args[2] };
      // Detach structured UI values now, before any queued asynchronous work.
      if (args[2].uiAction) args[2].uiAction = structuredClone(args[2].uiAction);
      const sendSnapshot = !Array.isArray(args[1])
        ? (typeof target.runtime.captureSendSnapshot === 'function'
          ? target.runtime.captureSendSnapshot()
          : { draft: state.draft, files: Array.isArray(state.files) ? [...state.files] : [] })
        : null;
      // Serialize only capture/dispatch decisions, never wait for a breath here.
      submission = submission.then(async () => {
        const prepared = typeof target.runtime.prepareSend === 'function'
          ? await target.runtime.prepareSend(args[1], sendSnapshot)
          : (await target.runtime.waitForPendingFiles(), true);
        if (!prepared) return;
        if (disposed) return;
        const othersBusy = [...sessions.values()].some(other => other !== target && busy(other));
        const files = Array.isArray(args[1]) ? args[1] : sendSnapshot?.files || [];
        const hasAttachments = desktopAttachments && files.length > 0;
        if (hasAttachments && !target.local.currentScene.sceneId) { void target.runtime.send(...args); return; }
        if (hasAttachments || othersBusy || (args[2].mode !== 'interrupt' && (sendQueue.some(next => next.saved.phase !== 'failed') || busy(target)))) {
          // Older/embedded runtimes may not expose the durable queue hook yet.
          // Keep sending functional while the host is being upgraded; the full
          // Desktop runtime supplies stageQueuedSend and persists the entry.
          if (typeof target.runtime.stageQueuedSend !== 'function') {
            void target.runtime.send(...args);
            return;
          }
          const entry = target.runtime.stageQueuedSend(...args);
          if (!entry) return;
          const saved: SavedSceneSend = { id: crypto.randomUUID(), endpoint: queueStore.endpoint,
            scene: { ...target.local.currentScene }, text: entry.text, files: entry.files,
            createdAt: entry.message.createdAt || Date.now(), order: sendQueue.length, phase: 'queued', sendOptions: entry.sendOptions, ...(hasAttachments ? {attachment:{delivery:'pending'}} : {}) };
          const queued = attachQueued(target, entry, saved, false);
          if (hasAttachments) entry.message.attachmentUploads = saved.files.map(f => ({name:f.name,size:f.size,mime:f.type,blob:f.blob,progress:f.uploadProgress || (f.attachmentId ? {phase:'complete',loaded:f.size,total:f.size} : undefined)}));
          try { await queueStore.write(saved); queued.persisted = true; entry.message.canInterruptQueued = !saved.attachment; }
          catch { entry.message.queueNotice = '排队内容未能保存，刷新可能丢失；请取消后重试'; }
          publish();
        } else {
          void target.runtime.send(...args);
        }
      });
      return submission;
    },
    selectScene(scene: any) {
      // Keep cached seeds and the network reconciliation behind one scene load.
      // Count queued selections too, so an older request cannot dismiss loading.
      const loading = state.historyLoading || scene.sceneId !== state.currentScene.sceneId;
      if (loading) { sceneLoads++; updateHistoryLoading(); }
      selection = selection.catch(() => {}).then(async () => {
        await selected.runtime.waitForPendingFiles();
        if (disposed) return;
        selected.local.draft = state.draft;
        const next = sessionFor(scene);
        if (next !== selected) state.resetScroll++;
        selected = next;
        selected.local.currentScene = { ...scene };
        state.currentScene = scene;
        state.historyScope = "current";
        state.draft = selected.local.draft;
        publish();
        await owner.runtime.restoreSceneHistory?.(scene);
        if (disposed) return;
        await owner.runtime.refreshHistory();
      }).finally(() => {
        if (loading) { sceneLoads--; updateHistoryLoading(); }
      });
      return selection;
    },
    dispose() {
      disposed = true;
      attachmentLifetime.abort();
      releaseAttachmentMessageReader(queueStore.endpoint,messageViews);
      clearTimeout(attachmentPoll);
      clearTimeout(drainTimer);
      clearTimeout(activityTimer);
      for (const queued of [...sendQueue]) detachQueued(queued);
      state.queued = 0;
      if (lastActivity) options.onSceneActivity?.({});
      if (!dispatching) closeQueueStore();
      for (const session of sessions.values()) session.runtime.dispose();
    },
    async refreshHistory() {
      historyRefreshes++;
      state.historyRefreshing = true;
      state.changed();
      try { await owner.runtime.refreshHistory(); }
      finally {
        historyRefreshes--;
        if (!disposed) { state.historyRefreshing = historyRefreshes > 0; state.changed(); }
      }
    },
    refreshOnRegainedAttention: async () => {await Promise.all([...sessions.values()].map(s => s.runtime.refreshOnRegainedAttention()));await syncAttachmentViews(true);},
  };
  runtime.stopCurrentTurn = async () => {
    const target = selected;
    if (target.local.stopping) return;
    const pending = sendQueue.filter(next => next.session === target && next.saved.attachment && !['sending','failed'].includes(next.saved.phase));
    if (!pending.length) {
      if (target.runtime.isSceneStreaming && !target.runtime.isSceneStreaming()) return;
      return target.runtime.stopCurrentTurn();
    }
    target.local.stopping = true; publish();
    try {
      // Abort every selected-scene attachment synchronously before awaiting persistence.
      await Promise.all(pending.map(next => next.entry.message.cancelQueued?.()));
      await target.runtime.stopCurrentTurn();
    } finally { target.local.stopping = false; publish(); }
  };
  for (const method of ["handleFiles", "removePending"])
    runtime[method] = (...args: any[]) => {
      selected.local.files = state.files;
      return selected.runtime[method](...args);
    };
  for (const method of ["loadLlmConfig", "applyConfigChange", "toggleSbs", "loadSbsState", "request", "revealHistory", "loadOlderHistory", "loadHistoryTarget"])
    runtime[method] = (...args: any[]) => owner.runtime[method](...args);
  return runtime as ChatRuntime;
}
