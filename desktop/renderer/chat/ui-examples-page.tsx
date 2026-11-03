import styles from './components/intelligent-ui-examples.module.scss';
import { useEffect, useState } from 'react';
import { IntelligentUIExamples, type UIExampleId } from './components/intelligent-ui-examples';

/** Standalone content of the desktop place panel; it never starts a chat session. */
export function UIExamplesPage() {
  const [example, setExample] = useState<UIExampleId>('bicycle');
  const revision = new URLSearchParams(location.search).get('revision');
  const send = (type: string, text?: string) => parent.postMessage({ type, text, revision }, '*');
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.data?.revision !== revision) return;
      if (event.data.type === 'beings:ui-examples-theme' && ['light', 'dark'].includes(event.data.theme))
        document.documentElement.dataset.theme = event.data.theme;
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [revision]);
  return <div className={styles.page}><IntelligentUIExamples embedded example={example} overlay={false} onSelect={setExample}
    onClose={() => send('beings:ui-examples-close')} onContinue={text => send('beings:ui-examples-continue', text)} /></div>;
}
