import { checkLocalFiles, type LocalFileAvailability as Availability } from './local-file-check';

// Coalesce a rendered message's paths into bounded metadata-only requests.
const pending = new Map<string, Promise<Availability>>();
const queue = new Map<string, (available: Availability) => void>();
let scheduled = false;

export function checkLocalFile(path: string, fresh = false): Promise<Availability> {
  const existing = pending.get(path);
  if (existing) return fresh ? existing.then(() => checkLocalFile(path)) : existing;
  const promise = new Promise<Availability>(resolve => queue.set(path, resolve));
  pending.set(path, promise);
  if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
  return promise;
}

function flush() {
  scheduled = false;
  const entries = [...queue]; queue.clear();
  const shell = window.parent === window ? window.beings : undefined;
  for (let start = 0; start < entries.length; start += 64) {
    let batch = entries.slice(start, start + 64);
    let id = '';
    const revision = new URLSearchParams(location.search).get('revision');
    let attempts = 0;
    let timeout: ReturnType<typeof setTimeout>;
    const send = () => {
      attempts++;
      const paths = batch.map(([path]) => path);
      if (shell) { void checkLocalFiles(shell, paths).then(finish); return; }
      id=crypto.randomUUID();
      timeout=setTimeout(()=>finish([]),5000);
      window.parent.postMessage({ type: 'beings:local-files-check', id, revision, paths }, '*');
    };
    const finish = (values: Availability[]) => {
      clearTimeout(timeout);
      id=''; // Ignore duplicate/late replies from this attempt, including during backoff.
      batch=batch.filter(([path,resolve],index)=>{
        const value=values[index];
        if(typeof value!=='boolean' && attempts<3)return true;
        pending.delete(path);resolve(typeof value==='boolean'?value:null);return false;
      });
      if(batch.length){timeout=setTimeout(send,250);return;}
      window.removeEventListener('message', receive);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (!id || event.source !== window.parent || data?.type !== 'beings:local-files-checked' || data.id !== id || data.revision !== revision) return;
      finish(Array.isArray(data.available) ? data.available : []);
    };
    if (!shell) window.addEventListener('message', receive);
    send();
  }
}
