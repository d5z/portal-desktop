import useEventListener from 'ahooks/es/useEventListener';
import type { ChatBridge } from '../services/bridge';

/** One stable subscription handles iframe shortcuts and reads the current selection. */
export function useChatShortcuts(bridge: ChatBridge, selectedText: string | undefined, addToChat: (text: string) => void, isMac: boolean) {
  useEventListener('keydown', event => {
    if (event.isComposing || event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (event.shiftKey && key === 'p') {
      event.preventDefault(); event.stopPropagation();
      bridge.send({ type: 'beings:plugin-commands' });
    } else if (key === 'f') {
      event.preventDefault(); event.stopPropagation();
      bridge.send({ type: 'beings:chat-search' });
    } else if (key === ',') {
      event.preventDefault(); event.stopPropagation();
      bridge.send({ type: 'beings:open-settings' });
    } else if (selectedText && event.code === 'KeyL' && (isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();
      addToChat(selectedText);
    }
  }, { target: document, capture: true });
}
