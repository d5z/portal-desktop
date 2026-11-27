import { useContext, useEffect, useState } from 'react';
import type { ConnectorImport } from '../../../shared/connector-resources';
import { connectorWorkspaceImports } from '../services/connector-workspace-store';
import { ConnectorResourceAction, ConnectorWorkspaceFile } from './connector-workspace-file';

/** Resume interrupted saves inside the existing workspace, including after app restart. */
export function ConnectorWorkspaceImports() {
  const resources = useContext(ConnectorResourceAction);
  const [items, setItems] = useState<ConnectorImport[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const context = await resources?.context();
      if (active) setItems(context?.account && context.endpoint ? connectorWorkspaceImports(context).filter(item => !['ready', 'deleted'].includes(item.state)) : []);
    };
    const changed = () => { void refresh().catch(() => { if (active) setItems([]); }); };
    changed(); window.addEventListener('focus', changed); window.addEventListener('beings:connector-imports-updated', changed);
    return () => { active = false; window.removeEventListener('focus', changed); window.removeEventListener('beings:connector-imports-updated', changed); };
  }, [resources]);
  if (!items.length) return null;
  return <section aria-label="待完成的工作区保存"><h4>文件保存任务</h4>{items.map(item => <ConnectorWorkspaceFile key={item.import_id} initial={item} />)}</section>;
}
