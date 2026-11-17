import { createContext, useContext, useRef, useState } from 'react';
import { IntelligentUI, type UIActions } from './view';
import { ErrorIndicator } from '../components/error-indicator';
import { blockKey, surfaceRepairPrompt, type SurfaceBlock } from './surfaces';

export const SurfaceContext = createContext<{
  blocks: Map<string, SurfaceBlock>;
} | null>(null);

export function SurfaceArtifact({ messageId, blockId, source, streaming, ...actions }: UIActions & {
  messageId?: string; blockId: string; source: string; streaming: boolean;
}) {
  const context = useContext(SurfaceContext);
  const snapshot = useRef<Parameters<NonNullable<UIActions['onSnapshot']>> | null>(null);
  const entry = messageId ? context?.blocks.get(blockKey(messageId, blockId)) : undefined;
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  if (!entry || !context) return <IntelligentUI source={source} streaming={streaming} {...actions} onEdit={undefined} />;
  const { surface } = entry;
  const latest = surface.versions.at(-1);
  const anchor = `iui-surface-${encodeURIComponent(surface.scope + ':' + surface.id)}`;
  if (!entry.owner) return <div className="iui-update-reference" role="status">
    {entry.error ? <ErrorIndicator description={`界面未更新：${entry.error}`} retry={actions.onContinue && {
      label: '让 Being 修正', run: () => actions.onContinue?.(surfaceRepairPrompt(surface, entry.error)),
    }} /> : entry.pending ? '正在更新原界面…' : `已更新「${latest?.doc.title || '交互界面'}」`}
    {' '}<button type="button" onClick={() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>查看原界面</button>
  </div>;
  const version = surface.versions.find(v => v.revision === selectedRevision) || latest;
  const activate = () => {
    if (!latest || selectedRevision !== null || !snapshot.current) return false;
    const [text, values, apps] = snapshot.current;
    actions.onSnapshot?.(text, values, apps, true);
    return true;
  };
  return <div id={anchor} className="iui-surface">
    {surface.versions.length > 1 && <label className="iui-version-picker">界面版本 <select aria-label="界面版本" value={selectedRevision ?? 'latest'} onChange={event => setSelectedRevision(event.target.value === 'latest' ? null : Number(event.target.value))}>
      <option value="latest">最新 · 第 {latest!.revision} 版</option>
      {surface.versions.slice(0, -1).map(v => <option key={v.revision} value={v.revision}>第 {v.revision} 版</option>)}
    </select>{selectedRevision !== null && <span>历史预览 · 选择不会影响当前版本</span>}</label>}
    <IntelligentUI key={selectedRevision ?? 'latest'} source={version ? JSON.stringify(version.doc) : source} streaming={!version && streaming} {...actions}
      onRepair={actions.onContinue ? error => actions.onContinue?.(surfaceRepairPrompt(surface, entry.error || error)) : actions.onRepair}
      storageKey={selectedRevision === null ? JSON.stringify(['surface', surface.scope, surface.id]) : undefined}
      submitDisabled={!latest || selectedRevision !== null}
      onEdit={actions.onEdit && latest && selectedRevision === null ? () => {
        if (activate()) actions.onEdit?.();
      } : undefined}
      onContinue={actions.onContinue ? text => {
        if (!latest || selectedRevision !== null) return;
        // Generated buttons and nested apps must opt into the same context as “修改”.
        if (activate()) actions.onEdit?.();
        actions.onContinue?.(text);
      } : undefined}
      onActivate={() => {
        activate();
      }}
      onSnapshot={(_text, values, apps) => {
        if (selectedRevision !== null) return;
        const current: Parameters<NonNullable<UIActions['onSnapshot']>> = [JSON.stringify({ surfaceId: surface.id, revision: latest?.revision || 0, title: version?.doc.title, document: version?.doc, values, apps }), values, apps];
        snapshot.current = current;
        actions.onSnapshot?.(...current);
      }}
 />
  </div>;
}
