/** Deliberately small declarative schema; no evaluation, remote refs, regex or executable code. */
export interface PluginAgentField { type: 'string' | 'boolean' | 'number' | 'strings'; title: string; maxLength?: number; maxItems?: number; enum?: string[] }
export interface PluginAgentContract { description: string; instructions: string; fields: Record<string, PluginAgentField>; required: string[] }
export type PluginAgentData = Record<string, string | boolean | number | string[]>;
export interface PluginAgentRecord { id: string; revision: number; data: PluginAgentData; createdAt: string; updatedAt: string }
export interface PluginAgentPreferences { guidance: string; focusId: string | null }
export interface PluginAgentEvent { id: string; recordId?: string; at: string; actor: 'user' | 'being'; sceneId?: string; kind: 'created' | 'updated' | 'configured'; note: string; changes?: PluginAgentData }
export interface PluginAgentSnapshot { scopeId: string; revision: number; records: PluginAgentRecord[]; events: PluginAgentEvent[]; preferences: PluginAgentPreferences }
export type PluginAgentMutation =
  | { op: 'create'; requestId: string; data: PluginAgentData }
  | { op: 'update'; requestId: string; id: string; expectedRevision: number; patch: PluginAgentData; note: string }
  | { op: 'configure'; requestId: string; expectedRevision: number; preferences: Partial<PluginAgentPreferences>; note: string };
export interface PluginAgentMutationResult { revision: number; record?: PluginAgentRecord; preferences: PluginAgentPreferences; replayed?: boolean }
export interface PluginAgentAPI {
  snapshot(): Promise<PluginAgentSnapshot>;
  mutate(input: PluginAgentMutation): Promise<PluginAgentMutationResult>;
  onChange(callback: (event: import('./index').PluginChangeEvent) => void): Promise<() => void>;
}
