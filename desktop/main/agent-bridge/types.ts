import type { SceneTask, SubagentTaskDetail, WorkProject } from '../../shared/types';
import type { WorkModelSelection } from '../../shared/work';

export interface AgentDescriptor { id: string; name: string; available: boolean; canExecute?: boolean; message?: string }
export interface AgentSnapshot { projects: WorkProject[]; tasks: SceneTask[] }
export type AgentTurn = { turnId: string } | { requestId: string };
/** Native IDs are adapter-owned; the bridge only namespaces them and routes operations. */
export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  status(): Promise<AgentDescriptor>;
  list(selectedIds?: Set<string>): Promise<AgentSnapshot>;
  read(id: string): Promise<SubagentTaskDetail>;
  start(directory: string, message: string, modelSelection?: WorkModelSelection, onCreated?: (nativeId: string) => Promise<void>): Promise<string>;
  send(id: string, message: string): Promise<AgentTurn | void>;
  steer?(id: string, message: string): Promise<void>;
  cancel(id: string): Promise<void>;
  connect?(): Promise<void>;
  native?(request: Request): Promise<Response>;
  close(): void;
}
export class AgentError extends Error {
  constructor(message: string, readonly status = 502, readonly body = JSON.stringify({ error: message }), readonly contentType = 'application/json') { super(message); }
}
export const agentTaskId = (agent: string, id: string) => `agent_${agent}_${id}`;
