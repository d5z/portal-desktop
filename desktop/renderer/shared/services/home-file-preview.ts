/** Only a relative workspace path crosses the sandbox bridge, never a token or arbitrary URL. */
export function requestHomeFilePreview(path: string) {
  window.parent.postMessage({ type: 'beings:home-file-preview', path,
    revision: new URLSearchParams(location.search).get('revision') }, '*');
}
