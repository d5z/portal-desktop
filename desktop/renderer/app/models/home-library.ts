import { MAX_HOME_PREVIEW, type HomeFilesAPI, type HomeFileEntry, type HomeFilePreview } from '../../../shared/home';
import { Store, errorText } from '../../shared/models/store';

const nameOrder = new Intl.Collator('zh-CN', { numeric: true });

export class HomeLibrary extends Store {
  path = '';
  entries: HomeFileEntry[] = [];
  loading = false;
  loaded = false;
  error = '';
  notice = '';
  busy = false;
  selected: HomeFileEntry | null = null;
  preview: HomeFilePreview | null = null;
  previewLoading = false;
  previewError = '';
  private generation = 0;
  private listing = 0;
  private previewRequest = 0;
  constructor(private api: HomeFilesAPI) { super(); }
  reset() {
    this.generation++; this.listing++; this.previewRequest++;
    this.path = ''; this.entries = []; this.loaded = false; this.loading = false;
    this.busy = false; this.error = ''; this.notice = ''; this.selected = null;
    this.preview = null; this.previewError = ''; this.previewLoading = false; this.changed();
  }
  async load(path = this.path) {
    const ticket = ++this.listing;
    if (this.path !== path) { this.entries = []; this.loaded = false; }
    this.path = path; this.loading = true; this.error = ''; this.changed();
    try {
      const result = await this.api.list(path);
      if (ticket !== this.listing) return;
      this.entries = [...result.entries].sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || nameOrder.compare(a.name, b.name));
      this.loaded = true;
    } catch (error) {
      if (ticket !== this.listing) return;
      // Failed auth/identity validation must not leave old private entries visible.
      this.entries = []; this.loaded = false; this.error = errorText(error);
    } finally { if (ticket === this.listing) { this.loading = false; this.changed(); } }
  }
  closePreview() { this.previewRequest++; this.selected = null; this.preview = null; this.previewError = ''; this.previewLoading = false; this.changed(); }
  async open(entry: HomeFileEntry) {
    if (entry.type === 'directory') return this.load(entry.path);
    const ticket = ++this.previewRequest;
    this.notice = ''; this.error = '';
    this.selected = entry; this.preview = null; this.previewError = ''; this.previewLoading = entry.size <= MAX_HOME_PREVIEW; this.changed();
    if (!this.previewLoading) return;
    try {
      const result = await this.api.preview(entry.path);
      if (ticket === this.previewRequest) this.preview = result;
    } catch (error) { if (ticket === this.previewRequest) this.previewError = errorText(error); }
    finally { if (ticket === this.previewRequest) { this.previewLoading = false; this.changed(); } }
  }
  async download(path: string): Promise<boolean> {
    if (this.busy) return false;
    const generation = this.generation;
    this.busy = true; this.error = ''; this.notice = ''; this.changed();
    try {
      const saved = await this.api.download(path);
      if (generation !== this.generation || !saved) return false;
      this.notice = '文件已保存';
      return true;
    } catch (error) {
      if (generation === this.generation) this.error = errorText(error);
      return false;
    } finally { if (generation === this.generation) { this.busy = false; this.changed(); } }
  }
}
