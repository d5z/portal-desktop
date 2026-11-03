import { useEffect, useRef, useState } from 'react';
import type { AppModel } from '../models/app';

/** Use the same place panel as Town while retaining the chat runtime's sandbox. */
export function UIExamplesPlace({ app }: { app: AppModel }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [revision] = useState(() => crypto.randomUUID());
  const syncTheme = () => frame.current?.contentWindow?.postMessage({ type: 'beings:ui-examples-theme', theme: app.colorScheme, revision }, 'beings://chat');
  useEffect(syncTheme, [app.colorScheme, revision]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== 'beings://chat' || event.source !== frame.current?.contentWindow || event.data?.revision !== revision) return;
      if (event.data.type === 'beings:ui-examples-close') app.returnFromUIExamples();
      if (event.data.type === 'beings:ui-examples-continue' && typeof event.data.text === 'string' && event.data.text.length <= 100000)
        app.returnFromUIExamples(event.data.text);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [app, revision]);
  return <iframe ref={frame} className="ui-examples-frame" title="智能交互示例" src={`beings://chat/?ui_examples=1&revision=${revision}`}
    sandbox="allow-scripts allow-same-origin" onLoad={syncTheme} />;
}
