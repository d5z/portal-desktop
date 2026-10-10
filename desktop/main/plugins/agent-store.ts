import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PluginAgentContract, PluginAgentMutation, PluginAgentMutationResult, PluginAgentSnapshot, PluginAgentRecord } from '../../../plugins/sdk';
import { agentKeys, agentObject, agentRevision, agentText, validateAgentData } from '../../shared/plugin-agent';
import { pluginId } from '../../shared/plugins';
type Check = () => void;
type State = Omit<PluginAgentSnapshot, 'scopeId'> & { schemaVersion: 1; requests: { key: string; hash: string; result: PluginAgentMutationResult }[] };
const maximum = 4 * 1024 * 1024;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const empty = (): State => ({ schemaVersion: 1, revision: 0, records: [], events: [], requests: [], preferences: { guidance: '', focusId: null } });
/** Called only inside PluginRegistry's serialized authorization/write queue. No plugin business logic. */
export class PluginAgentStore {
  constructor(private root: string) {}
  private scope(endpoint: string) { if (!endpoint) throw new Error('请先连接 Being。'); return createHash('sha256').update(endpoint).digest('hex'); }
  private file(id: string, endpoint: string) { pluginId(id); return path.join(this.root, id, `${this.scope(endpoint)}.json`); }
  private async read(id: string, endpoint: string): Promise<State> {
    const file = this.file(id, endpoint);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new Error('插件协作数据文件无效或过大。');
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.records) || !Array.isArray(data.events) || !Array.isArray(data.requests) || typeof data.preferences?.guidance !== 'string' || !(data.preferences.focusId === null || typeof data.preferences.focusId === 'string')) throw new Error('插件协作数据损坏，未覆盖原文件。');
      return data;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw error; }
  }
  async snapshot(id: string, endpoint: string, check: Check): Promise<PluginAgentSnapshot> {
    check(); const { schemaVersion: _, requests: __, ...data } = await this.read(id, endpoint); check();
    return { scopeId: this.scope(endpoint), ...data };
  }
  async mutate(id: string, endpoint: string, contract: PluginAgentContract, input: unknown, actor: 'user' | 'being', sceneId: string | undefined, check: Check) {
    agentObject(input); agentText(input.requestId, 100, true);
    if (!/^[a-zA-Z0-9_.:-]+$/.test(input.requestId)) throw new Error('requestId 格式无效。');
    if (input.op === 'create') { agentKeys(input, ['op', 'requestId', 'data']); validateAgentData(contract, input.data); }
    else if (input.op === 'update') {
      agentKeys(input, ['op', 'requestId', 'id', 'expectedRevision', 'patch', 'note']);
      agentText(input.id, 100, true); agentRevision(input.expectedRevision); validateAgentData(contract, input.patch, true); agentText(input.note, 1000, true);
    } else if (input.op === 'configure') {
      agentKeys(input, ['op', 'requestId', 'expectedRevision', 'preferences', 'note']); agentRevision(input.expectedRevision); agentText(input.note, 1000, true);
      agentObject(input.preferences); agentKeys(input.preferences, ['guidance', 'focusId']);
      if ('guidance' in input.preferences) agentText(input.preferences.guidance, 2000);
      if ('focusId' in input.preferences && input.preferences.focusId !== null) agentText(input.preferences.focusId, 100, true);
    } else throw new Error('未知插件协作操作。');
    const command = structuredClone(input) as PluginAgentMutation;
    check(); const data = await this.read(id, endpoint);
    const hash = createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex');
    const key = `${actor}:${command.requestId}`;
    const previous = data.requests.find(request => request.key === key);
    if (previous) { if (previous.hash !== hash) throw new Error('requestId 已用于不同操作。'); check(); return { ...previous.result, replayed: true }; }
    const at = new Date().toISOString(), event = { id: randomUUID(), at, actor, ...(sceneId ? { sceneId } : {}) };
    let record: PluginAgentRecord | undefined;
    if (command.op === 'create') {
      if (data.records.length >= 500) throw new Error('插件协作记录已达到 500 条上限。');
      record = { id: randomUUID(), revision: 1, data: command.data, createdAt: at, updatedAt: at };
      data.records.push(record); data.events.push({ ...event, kind: 'created', recordId: record.id, note: '创建记录', changes: command.data });
    } else if (command.op === 'update') {
      record = data.records.find(record => record.id === command.id);
      if (!record) throw new Error('插件记录不存在。');
      if (command.expectedRevision !== record.revision) throw new Error('记录已更新，请重新读取后合并修改。');
      const merged = { ...record.data, ...command.patch }; validateAgentData(contract, merged);
      record.data = merged; record.revision++; record.updatedAt = at;
      data.events.push({ ...event, kind: 'updated', recordId: record.id, note: command.note, changes: command.patch });
    } else {
      if (command.expectedRevision !== data.revision) throw new Error('插件协作数据已更新，请刷新后重试。');
      if (command.preferences.focusId && !data.records.some(record => record.id === command.preferences.focusId)) throw new Error('关注记录不存在。');
      data.preferences = { ...data.preferences, ...command.preferences };
      data.events.push({ ...event, kind: 'configured', ...(data.preferences.focusId ? { recordId: data.preferences.focusId } : {}), note: command.note });
    }
    data.revision++;
    const result: PluginAgentMutationResult = { revision: data.revision, ...(record ? { record: structuredClone(record) } : {}), preferences: { ...data.preferences } };
    data.requests = [...data.requests, { key, hash, result }].slice(-256); data.events = data.events.slice(-2000);
    const json = JSON.stringify(data); if (Buffer.byteLength(json) > maximum) throw new Error('插件协作数据超过 4 MB，未保存。');
    const file = this.file(id, endpoint), temp = `${file}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try { await writeFile(temp, json, { flag: 'wx', mode: 0o600 }); check(); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
    return result;
  }
}
