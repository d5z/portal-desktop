import { postFilePreview } from './file-preview-bridge';

/** Only a relative workspace path crosses the sandbox bridge, never a token or arbitrary URL. */
export function requestHomeFilePreview(path: string, action: 'preview' | 'download' = 'preview') {
  if (action === 'preview') {
    postFilePreview({ type: 'beings:home-file-preview', path });
    return;
  }
  window.parent.postMessage({ type: 'beings:home-file-download', path,
    revision: new URLSearchParams(location.search).get('revision') }, '*');
}
