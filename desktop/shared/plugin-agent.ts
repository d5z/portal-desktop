import type { PluginAgentContract, PluginAgentData, PluginAgentField } from '../../plugins/sdk';
export function agentObject(value: unknown): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件协作请求需要 JSON 对象。');
}
export function agentKeys(value: Record<string, any>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('插件协作请求包含未声明字段。');
}
export function agentText(value: unknown, max: number, required = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) throw new Error('插件协作文本为空或过长。');
}
export function agentRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('需要有效的 expectedRevision。');
}
export function parseAgentContract(raw: unknown): PluginAgentContract {
  agentObject(raw); agentKeys(raw, ['description', 'instructions', 'fields', 'required']);
  agentText(raw.description, 1000, true); agentText(raw.instructions, 6000, true);
  agentObject(raw.fields);
  const names = Object.keys(raw.fields);
  if (!names.length || names.length > 24 || names.some(key => !/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key) || ['constructor', 'prototype'].includes(key))) throw new Error('插件字段声明无效。');
  if (!Array.isArray(raw.required) || raw.required.some(key => !names.includes(key)) || new Set(raw.required).size !== raw.required.length) throw new Error('必填字段声明无效。');
  const fields: Record<string, PluginAgentField> = {};
  for (const name of names) {
    const field = raw.fields[name]; agentObject(field); agentKeys(field, ['type', 'title', 'maxLength', 'maxItems', 'enum']);
    if (!['string', 'boolean', 'number', 'strings'].includes(field.type)) throw new Error('不支持的插件字段类型。');
    agentText(field.title, 100, true);
    if (field.maxLength !== undefined && (!['string', 'strings'].includes(field.type) || !Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 6000)) throw new Error('字段长度声明无效。');
    if (field.maxItems !== undefined && (field.type !== 'strings' || !Number.isInteger(field.maxItems) || field.maxItems < 1 || field.maxItems > 30)) throw new Error('数组长度声明无效。');
    if (field.enum !== undefined) {
      if (field.type !== 'string' || !Array.isArray(field.enum) || !field.enum.length || field.enum.length > 30 || new Set(field.enum).size !== field.enum.length) throw new Error('枚举声明无效。');
      field.enum.forEach(item => agentText(item, field.maxLength || 1000, true));
    }
    fields[name] = { ...field } as PluginAgentField;
  }
  return { description: raw.description, instructions: raw.instructions, fields, required: [...raw.required] };
}
export function validateAgentData(contract: PluginAgentContract, value: unknown, partial = false): asserts value is PluginAgentData {
  agentObject(value); agentKeys(value, Object.keys(contract.fields));
  if (JSON.stringify(value).length > 12000) throw new Error('单条插件协作数据超过 12000 字符。');
  if (!partial && contract.required.some(key => !Object.hasOwn(value, key))) throw new Error('插件数据缺少必填字段。');
  for (const [key, item] of Object.entries(value)) {
    const field = contract.fields[key];
    if (field.type === 'string') { agentText(item, field.maxLength || 1000, contract.required.includes(key)); if (field.enum && !field.enum.includes(item)) throw new Error(`字段 ${key} 不在声明的枚举内。`); }
    else if (field.type === 'strings') {
      if (!Array.isArray(item) || item.length > (field.maxItems || 12)) throw new Error(`字段 ${key} 数组无效。`);
      item.forEach(text => agentText(text, field.maxLength || 1000, true));
    } else if (field.type === 'boolean' ? typeof item !== 'boolean' : typeof item !== 'number' || !Number.isFinite(item)) throw new Error(`字段 ${key} 类型无效。`);
  }
}
