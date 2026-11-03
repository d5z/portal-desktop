import { contextBridge, ipcRenderer } from 'electron';
import type { ViewerAPI, ViewerEvent } from '../shared/home-viewer';
const api: ViewerAPI = {
  request: (operation, value) => ipcRenderer.invoke('home-viewer:request', operation, value),
  send: (id, data) => ipcRenderer.send('home-viewer:send', id, data),
  ack: (id, sequence) => ipcRenderer.send('home-viewer:ack', id, sequence),
  subscribe: callback => {
    const listener = (_event: unknown, value: ViewerEvent) => callback(value);
    ipcRenderer.on('home-viewer:event', listener);
    return () => ipcRenderer.removeListener('home-viewer:event', listener);
  },
};
contextBridge.exposeInMainWorld('homeViewer', api);
