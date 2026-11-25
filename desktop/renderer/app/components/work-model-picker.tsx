import { useEffect, useState } from 'react';
import type { WorkModelSelection } from '../../../shared/work';
import { workExecutors, type WorkModelGroup } from '../models/work-executors';

const optionKey = ({ provider, model }: WorkModelSelection) => JSON.stringify([provider || '', model]);

export function WorkModelPicker({ endpoint, executor, value, onChange, disabled }: {
  endpoint: string;
  executor: 'codex' | 'deepseek';
  value?: WorkModelSelection | null;
  onChange: (value: WorkModelSelection | null) => void;
  disabled?: boolean;
}) {
  const [groups, setGroups] = useState<WorkModelGroup[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void workExecutors(endpoint)[executor].models(controller.signal).then(result => {
      if (!controller.signal.aborted) setGroups(result);
    }, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [endpoint, executor]);

  const selected = value ? optionKey(value) : '';
  const hasSelection = groups?.some(group => group.id === (value?.provider || '') && group.models.some(model => model.id === value?.model));
  const defaultLabel = failed ? '默认模型（列表读取失败）' : groups ? '默认模型' : '默认模型（正在加载…）';
  return <select aria-label="模型" title={executor === 'deepseek' ? '选择模型并启动会话时，DeepSeek Harness 会更新后续新会话的默认模型' : undefined}
    value={selected} disabled={disabled} onChange={event => {
    const key = event.target.value;
    if (!key) { onChange(null); return; }
    const [provider, model] = JSON.parse(key) as [string, string];
    onChange(provider ? { provider, model } : { model });
  }}>
    <option value="">{defaultLabel}</option>
    {value && !hasSelection && <option value={selected}>{value.model}</option>}
    {groups?.filter(group => group.models.length).map(group => <optgroup key={group.id} label={group.name}>
      {group.models.map(model => {
        const key = optionKey({ provider: group.id, model: model.id });
        return <option key={key} value={key}>{model.name || model.id}</option>;
      })}
    </optgroup>)}
  </select>;
}
