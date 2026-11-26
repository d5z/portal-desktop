import { connectorImport, type ConnectorContext, type ConnectorImport } from '../../../shared/connector-resources';

const key = (context: ConnectorContext) => `beings:connector-imports:${encodeURIComponent(JSON.stringify([context.endpoint, context.account]))}`;
export function connectorWorkspaceImports(context: ConnectorContext): ConnectorImport[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(key(context)) || '[]');
    return Array.isArray(values) ? values.flatMap(value => { const item = connectorImport(value); return item ? [item] : []; }) : [];
  } catch { return []; }
}
/** Persist task identities and verified metadata, never credentials or download references. */
export function rememberConnectorImport(context: ConnectorContext, item: ConnectorImport) {
  const items = new Map(connectorWorkspaceImports(context).map(value => [value.import_id, value]));
  const previous = items.get(item.import_id);
  items.set(item.import_id, item);
  try {
    const value = JSON.stringify([...items.values()]);
    if (localStorage.getItem(key(context)) === value) return;
    localStorage.setItem(key(context), value);
    window.dispatchEvent(new Event('beings:connector-imports-updated'));
    if (previous?.state !== item.state && (item.state === 'ready' || item.state === 'deleted'))
      window.dispatchEvent(new Event('beings:connector-workspace-changed'));
  } catch { /* The server task remains recoverable from its original tool result. */ }
}
