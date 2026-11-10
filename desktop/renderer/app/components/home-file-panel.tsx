import { DrawerPresence } from "../../shared/components/workspace-drawer";
import { MAX_HOME_PREVIEW, HOME_PREVIEW_TOO_LARGE } from '../../../shared/home';
import { lazy, Suspense, useState } from 'react';
import { FilePreviewPanel, FilePreviewModes } from './file-preview-panel';
import { IconButton } from '../../shared/components/icon-button';
import { Icon } from '../../shared/icons/icon';
import { useModel } from '../../shared/hooks/use-model';
import type { HomeLibrary } from '../models/home-library';
import styles from './home-library.module.scss';
const FileContent = lazy(() => import('./home-file-preview').then(module => ({ default: module.HomeFileContent })));
/** The library and conversation receipts share one preview and download surface. */
export function HomeFilePanel({ store }: { store: HomeLibrary }) {
  const model = useModel(store);
  return <DrawerPresence open={!!model.selected}>{model.selected && <SelectedFilePanel key={model.selected.path} model={model} />}</DrawerPresence>;
}
function SelectedFilePanel({ model }: { model: HomeLibrary }) {
  const [source, setSource] = useState(false);
  const selected = model.selected!;
  const html = /\.html?$/i.test(selected.path);
  return <FilePreviewPanel portal name={selected.name} path={selected.path} onClose={() => model.closePreview()}
    actions={<>
      {html && model.preview && <FilePreviewModes source={source} onChange={setSource} />}
      <IconButton className="file-preview-icon" label="下载文件" disabled={model.busy} onClick={() => void model.download(selected.path)}><Icon name="download-wide" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" /></IconButton>
    </>}>
      {model.error && <p className={styles.previewFeedback} role="alert">{model.error}</p>}
      {model.notice && <p className={styles.previewFeedback} role="status">{model.notice}</p>}
      {selected.size > MAX_HOME_PREVIEW ? <p className={styles.previewFeedback} role="status">{HOME_PREVIEW_TOO_LARGE}</p> : model.previewLoading ? <div className={styles.previewLoading} role="status"><span aria-hidden="true" /><span>正在读取文件…</span></div> : model.previewError ? <div className={styles.previewFeedback} role="alert"><p>{model.previewError}</p><button type="button" onClick={() => void model.open(selected)}>重试预览</button></div> : model.preview && <Suspense fallback={<div className={styles.previewLoading} role="status"><span aria-hidden="true" /><span>正在加载预览…</span></div>}><FileContent key={model.preview.path} file={model.preview} source={source} /></Suspense>}
    </FilePreviewPanel>;
}
