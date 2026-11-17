export function postFilePreview(data: Record<string, unknown>, opener = document.activeElement as HTMLElement | null) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    opener?.focus({ preventScroll: true });
    port1.close();
  };
  const revision = new URLSearchParams(location.search).get('revision');
  window.parent.postMessage({ ...data, revision }, '*', [port2]);
}
