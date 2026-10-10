/** Injected into the isolated document before the author's bundle. No host globals. */
export const PLUGIN_SDK = String.raw`
(() => {
  const channel = document.currentScript.dataset.channel;
  const view = document.currentScript.dataset.view;
  const command = document.currentScript.dataset.command || undefined;
  const slot = document.currentScript.dataset.slot || undefined;
  let sequence = 0;
  const pending = new Map(), themes = new Set(), deltas = new Set(), unloads = new Set(), subscriptions = new Map();
  const subscribe = (set, callback) => { if (typeof callback !== 'function') throw new Error('Expected a callback'); set.add(callback); return () => set.delete(callback); };
  addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault(); parent.postMessage({ type: 'grove:commands', channel }, '*');
    }
  });
  addEventListener('error', event => parent.postMessage({ type: 'grove:error', channel, error: String(event.message).slice(0, 1000) }, '*'));
  addEventListener('unhandledrejection', () => parent.postMessage({ type: 'grove:error', channel, error: '插件异步操作失败，请重新打开。' }, '*'));
  function request(method, value) {
    if (pending.size >= 8) return Promise.reject(new Error('Too many plugin requests'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Plugin request timed out; do not automatically resend')); }, method === 'being.chat' ? 600000 : 30000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ type: 'grove:request', channel, id, method, value }, '*');
    });
  }
  async function listen(topic, callback) {
    if (typeof callback !== 'function') throw new Error('Expected a callback');
    const id = ++sequence; subscriptions.set(id, callback);
    try { await request('events.subscribe', { topic, id }); }
    catch (error) { subscriptions.delete(id); throw error; }
    return () => { if (subscriptions.delete(id)) void request('events.unsubscribe', { topic, id }).catch(() => {}); };
  }
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== channel) return;
    const message = event.data;
    if (message.type === 'grove:event' && message.event === 'subscription') {
      const callback = subscriptions.get(message.data?.id);
      if (callback) { try { Promise.resolve(callback(message.data.event)).catch(() => {}); } catch {} }
      return;
    }
    if (message.type === 'grove:event' && message.event === 'being.delta') {
      for (const callback of deltas) { try { callback(message.data); } catch {} }
      return;
    }
    if (message.type === 'grove:theme') {
      document.documentElement.dataset.theme = message.theme;
      for (const callback of themes) { try { callback(message.theme); } catch {} }
    }
    if (message.type !== 'grove:response') return;
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    message.error ? item.reject(new Error(message.error)) : item.resolve(message.value);
  });
  Object.defineProperty(window, 'grove', { value: Object.freeze({
    apiVersion: 1, sdkVersion: '1.4.0', view, command, slot,
    loadData: () => request('storage.load'),
    saveData: value => request('storage.save', value),
    updateData: value => request('storage.patch', value),
    onTheme: callback => subscribe(themes, callback),
    onUnload: callback => subscribe(unloads, callback),
    agent: Object.freeze({ snapshot: () => request('agent.snapshot'), mutate: input => request('agent.mutate', input), onChange: callback => listen('agent.changed', callback) }),
    workspace: Object.freeze({ getContext: () => request('workspace.context'), onContextChange: callback => listen('workspace.changed', callback) }),
    events: Object.freeze({ subscribe: listen }),
    town: Object.freeze({ query: query => request('town.query', query) }),
    being: Object.freeze({
      context: () => request('being.context'),
      history: options => request('being.history', options),
      compose: text => request('being.compose', text),
      chat: text => request('being.chat', text),
      onDelta: callback => subscribe(deltas, callback),
      tasks: Object.freeze({ list: () => request('being.tasks.list'), onChange: callback => listen('tasks.changed', callback) })
    }),
    ui: Object.freeze({ notice: text => request('ui.notice', text), navigate: (view, id) => request('ui.navigate', { view, id }) })
  }) });
  addEventListener('pagehide', () => {
    for (const callback of unloads) { try { callback(); } catch {} }
    themes.clear(); deltas.clear(); unloads.clear(); subscriptions.clear();
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
  }, { once: true });
  parent.postMessage({ type: 'grove:ready', channel }, '*');
})();`;
