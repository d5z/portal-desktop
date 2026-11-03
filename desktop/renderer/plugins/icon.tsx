import { useId, useState } from 'react';
import { MAX_PLUGIN_ICON_BYTES, PLUGIN_ICON_TYPES, isPluginIconText, parsePluginIcon } from '../../shared/plugin-icon';
import { Dialog } from '../shared/components/dialog';
import { errorText } from '../shared/models/store';
import type { PluginsModel } from './model';
import clsx from 'clsx';
import styles from './icon.module.scss';

export function PluginIcon({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState<string>();
  if (icon?.startsWith('data:image/') && failed !== icon) {
    return <img className={styles.icon} src={icon} alt="" aria-hidden="true" draggable={false} onError={() => setFailed(icon)} />;
  }
  if (icon && isPluginIconText(icon)) return <span className={clsx(styles.icon, styles.text)} aria-hidden="true">{icon}</span>;
  return <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path className="rail-icon-line" pathLength="100" d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5V3Z" /></svg>;
}

export function PluginIconEditor({ model, id, view, title, overridden }: { model: PluginsModel; id: string; view: string; title: string; overridden: boolean }) {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const icon = model.icon(id, view);
  const save = async (value: string | null) => {
    setError('');
    try {
      if (value !== null) parsePluginIcon(value, false);
      await model.setIcon(id, view, value);
      if (!model.error) setOpen(false);
    } catch (e) { setError(errorText(e)); }
  };
  return <>
    <button className={clsx('secondary', styles.edit)} aria-label={`${title}导航图标`} title="自定义导航图标" disabled={model.busy || !model.api?.setIcon}
      onClick={() => { setDraft(icon || ''); setError(''); setOpen(true); }}><PluginIcon icon={icon} /><span>图标</span></button>
    <Dialog id={dialogId} className={styles.dialog} open={open} busy={reading || model.busy} onClose={() => setOpen(false)} aria-label={`${title}导航图标`} dismissOnBackdrop>
      <h2>{title} · 导航图标</h2>
      <div className={styles.preview} data-slot="plugin-icon-preview"><PluginIcon icon={draft || undefined} /></div>
      <label>Emoji 或短文字<input aria-label="Emoji 或短文字" value={draft.startsWith('data:') ? '' : draft} placeholder="例如：🌟" disabled={model.busy || reading} onChange={event => setDraft(event.target.value)} /></label>
      <label className={styles.file}>上传图片<input type="file" aria-label="上传图标图片" accept=".png,.jpg,.jpeg,.webp,.svg" disabled={model.busy || reading} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        setError(''); setReading(true);
        try {
          const type = PLUGIN_ICON_TYPES[file.name.split('.').pop()!.toLowerCase()];
          if (!type || !file.size || file.size > MAX_PLUGIN_ICON_BYTES) throw new Error('请选择不超过 256 KB 的 PNG、JPEG、WebP 或 SVG 图片。');
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败。'));
            reader.readAsDataURL(file);
          });
          const icon = parsePluginIcon(`data:${type};base64,${data.split(',')[1]}`, false);
          const preview = new Image();
          preview.src = icon;
          try { await preview.decode(); }
          catch { throw new Error('图片无法读取，请选择有效的图片文件。'); }
          setDraft(icon);
        } catch (e) { setError(errorText(e)); }
        finally { setReading(false); }
      }} /></label>
      <p className="field-help">PNG、JPEG、WebP、SVG，最大 256 KB。自定义图标仅用于本机导航入口。</p>
      {(error || model.error) && <p role="alert">{error || model.error}</p>}
      <div className={styles.actions}>
        <button className="secondary" disabled={model.busy || reading || !overridden} onClick={() => void save(null)}>恢复默认</button>
        <button className="secondary" disabled={model.busy || reading} onClick={() => setOpen(false)}>取消</button>
        <button className="primary" disabled={model.busy || reading || !draft} onClick={() => void save(draft)}>保存</button>
      </div>
    </Dialog>
  </>;
}
