/** Only a relative workspace path crosses the sandbox bridge, never a token or arbitrary URL. */
export function requestHomeFilePreview(path: string, action: 'preview' | 'download' = 'preview') {
  window.parent.postMessage({ type: action === 'download' ? 'beings:home-file-download' : 'beings:home-file-preview', path,
    revision: new URLSearchParams(location.search).get('revision') }, '*');
}
