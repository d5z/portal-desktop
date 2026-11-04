import { randomUUID } from 'node:crypto';
import type { Connection } from '../chat/connection';
import type { HomeAction, HomeComputer, HomeOperation, HomeState } from '../../shared/home';
import type { HomeClient } from './client';
import { HomeError, ticketURL } from './protocol';
export interface HomeMe {
  user: { id: string }; username: string | null;
  being: { id: string; being_id: string; display_name: string; provisioning_status: string } | null;
  computer_enabled: boolean; storage: { status: string } | null;
  storage_enabled?: boolean; files_enabled?: boolean;
}
interface Heart { configured: boolean; conflicted?: boolean; origin?: string; heart_being_id?: string }
interface Viewer { open(url: string, id: string): void; close(): void }
const json = (body = {}, key?: string): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
export class HomeService {
  state: HomeState = { authenticated: false, authenticating: false, viewer: 'closed' };
  private context = '';
  private viewIntent = 0;
  private generation = 0;
  private refreshFlight?: Promise<HomeState>;
  private actionFlight?: Promise<HomeState>;
  private me?: HomeMe;
  constructor(private client: HomeClient, private viewer: Viewer, private connection: () => Connection | null,
    private publish: (state: HomeState) => void) {}
  update(patch: Partial<HomeState> = {}) {
    this.state = { ...this.state, ...patch, authenticated: this.client.authenticated, authenticating: this.client.authenticating };
    this.publish(this.state); return this.state;
  }
  contextChanged() {
    const key = this.connection()?.endpoint || '';
    if (this.context === key) return;
    this.context = key; this.generation++; this.client.cancelRequests(); this.me = undefined; this.refreshFlight = undefined;
    this.viewer.close(); this.state = { authenticated: this.client.authenticated, authenticating: this.client.authenticating, viewer: 'closed' };
    this.update();
  }
  private current(generation: number) {
    this.contextChanged();
    if (generation !== this.generation) throw new Error('连接已切换，请重新打开电脑栏。');
  }
  /** Files remain available while the computer is stopped, disabled or unavailable. */
  async fileAccess() {
    this.contextChanged();
    const generation = this.generation;
    const session = this.client.sessionVersion;
    const check = () => {
      this.current(generation);
      if (this.client.authenticating) throw new Error('请先完成 Being Home 登录，再刷新资料库。');
      if (!this.client.authenticated) throw new Error('请先在电脑栏连接 Being Home。');
      if (session !== this.client.sessionVersion) throw new Error('Home 账号已切换，请刷新资料库。');
    };
    check();
    const me = await this.client.request<HomeMe>('/v1/me'); check();
    if (!me.being) throw new Error('请先在电脑栏初始化 Being Home。');
    const heart = await this.client.request<Heart>('/v1/me/heart'); check();
    const connection = this.connection();
    if (!connection || !heart.configured || heart.conflicted || heart.heart_being_id !== connection.being || heart.origin !== new URL(connection.endpoint).origin)
      throw new Error('请在电脑栏连接并关联当前 Being 的 Home 账号。');
    if (!me.storage_enabled || !me.files_enabled) throw new Error('当前 Home 尚未启用工作区文件服务。');
    if (me.storage?.status !== 'ready') throw new Error('云端存储正在准备，请稍后刷新。');
    return check;
  }
  async refresh(): Promise<HomeState> {
    this.contextChanged();
    if (this.refreshFlight) return this.refreshFlight;
    const generation = this.generation;
    const flight = this.read(generation).catch(error => {
      if (generation !== this.generation) return this.state;
      if (!this.client.authenticated) { this.me = undefined; this.viewer.close(); this.state = { authenticated: false, authenticating: false, viewer: 'closed' }; }
      return this.update({ error: error instanceof Error ? error.message : '无法读取云电脑状态。' });
    });
    this.refreshFlight = flight;
    try { return await flight; } finally { if (this.refreshFlight === flight) this.refreshFlight = undefined; }
  }
  private async read(generation: number) {
    if (!this.client.authenticated) return this.update();
    const me = await this.client.request<HomeMe>('/v1/me'); this.current(generation); this.me = me;
    const heart = me.being ? await this.client.request<Heart>('/v1/me/heart') : undefined; this.current(generation);
    const connection = this.connection();
    const matched = !!connection && !!heart?.configured && !heart.conflicted && heart.heart_being_id === connection.being && heart.origin === new URL(connection.endpoint).origin;
    let computer: HomeComputer | undefined;
    if (matched && me.computer_enabled && me.being) {
      try { computer = await this.client.request<HomeComputer>('/v1/me/computer'); }
      catch (error) { if (!(error instanceof HomeError && error.status === 404 && error.code === 'computer_not_initialized')) throw error; }
    }
    const browser = computer?.status === 'running' ? await this.client.request<{ ready: boolean }>('/v1/me/computer/browser') : undefined;
    this.current(generation);
    if (computer && computer.being_profile_id !== me.being?.id) throw new Error('云电脑与 Home 账号不匹配，请重新登录。');
    if (!matched || computer?.status !== 'running' || (this.state.computer &&
        (computer.id !== this.state.computer.id || computer.generation !== this.state.computer.generation))) this.viewer.close();
    let pending = this.client.pending;
    let operation = pending?.operation;
    if (operation && matched) {
      operation = await this.client.request<HomeOperation>('/v1/me/computer/operations/' + encodeURIComponent(operation.id));
      this.current(generation);
      if (['succeeded', 'failed'].includes(operation.status)) { await this.client.setPending(); pending = undefined; }
      else await this.client.setPending({ ...pending!, operation });
    }
    return this.update({ username: me.username || undefined, beingName: me.being?.display_name,
      needsInitialization: !me.being, binding: !connection ? 'no-connection' : matched ? 'matched' : heart?.configured ? 'mismatch' : 'missing',
      enabled: me.computer_enabled, browserReady: browser?.ready === true, storageReady: me.storage?.status === 'ready', computer, operation,
      pending: pending?.kind, error: operation?.status === 'failed' ? '电脑操作未完成，请刷新后重试。' : undefined });
  }
  action(action: HomeAction): Promise<HomeState> {
    this.contextChanged();
    if (action === 'close') { this.viewIntent++; this.viewer.close(); return Promise.resolve(this.state); }
    if (action === 'cancel-login') { this.client.cancelLogin(); return Promise.resolve(this.update()); }
    if (action === 'logout') {
      this.generation++; this.viewer.close(); this.me = undefined; this.refreshFlight = undefined; this.actionFlight = undefined;
      this.state = { authenticated: false, authenticating: false, viewer: 'closed' };
      return this.client.logout().then(() => this.update()).catch(error => this.update({ error: error.message }));
    }
    if (this.actionFlight) return Promise.resolve(this.state);
    const generation = this.generation, viewIntent = this.viewIntent;
    const flight = this.perform(action, generation, viewIntent).catch(error => {
      if (generation !== this.generation) return this.state;
      return this.update({ error: error instanceof Error ? error.message : '云电脑操作失败，请重试。' });
    });
    this.actionFlight = flight;
    void flight.finally(() => { if (this.actionFlight === flight) this.actionFlight = undefined; });
    return flight;
  }
  private async perform(action: HomeAction, generation: number, initialViewIntent: number): Promise<HomeState> {
    this.update({ error: undefined });
    if (action === 'login') {
      this.viewer.close(); await this.client.login(() => this.update()); this.current(generation); return this.refresh();
    }
    await this.refresh(); this.current(generation);
    if (this.state.error || !this.me) throw new Error(this.state.error || '请先连接 Being Home。');
    if (action === 'initialize') {
      if (!this.me.being) await this.client.request('/v1/me/bootstrap', json());
      this.current(generation); return this.refresh();
    }
    if (action === 'bind') {
      const connection = this.connection();
      if (!connection || !this.me.being || this.state.binding !== 'missing') throw new Error('请确认当前 Being 和 Home 账号后再关联。');
      await this.client.request('/v1/me/heart/import', json({ link: connection.link, acknowledge_binding: true }));
      this.current(generation); return this.refresh();
    }
    if (this.state.binding !== 'matched') throw new Error('请先关联当前 Being，或切换到对应的 Home 账号。');
    if (!this.state.enabled || !this.state.storageReady) throw new Error('云电脑或存储尚未就绪，请稍后刷新。');
    if (action === 'open') {
      if (initialViewIntent !== this.viewIntent) return this.state;
      const viewIntent = ++this.viewIntent;
      if (this.state.computer?.status !== 'running' || !this.state.browserReady || this.state.pending) throw new Error('请等待云电脑启动完成。');
      const computer = this.state.computer;
      const ticket = await this.client.request<{ ticket: string; expires_at: string; connect_url: string }>('/v1/me/computer/desktop-ticket', json());
      this.current(generation);
      // Recheck the machine after ticket acquisition; a stopped/replaced machine must not open an old viewer.
      const latest = await this.client.request<HomeComputer>('/v1/me/computer'); this.current(generation);
      if (latest.status !== 'running' || latest.id !== computer.id || latest.generation !== computer.generation) throw new Error('电脑状态已变化，请刷新后重新打开。');
      if (viewIntent !== this.viewIntent) return this.state;
      this.viewer.open(ticketURL(ticket), computer.id); return this.state;
    }
    const kind = action === 'wake' ? 'ensure' : action === 'stop' ? 'stop' : action === 'recreate' ? 'recreate' : undefined;
    if (!kind) throw new Error('不支持的云电脑操作。');
    const pending = this.client.pending;
    if (pending && pending.kind !== kind) throw new Error('请等待当前电脑操作完成。');
    if (pending?.operation) return this.refresh();
    const status = this.state.computer?.status;
    if (status && !['running', 'stopped', 'error'].includes(status)) throw new Error('电脑正在处理操作，请稍后刷新。');
    const intent = pending || { kind, key: randomUUID() };
    await this.client.setPending(intent); this.current(generation);
    this.update({ pending: kind });
    if (kind !== 'ensure') this.viewer.close();
    let queued: { computer: HomeComputer; operation: HomeOperation };
    try { queued = await this.client.request('/v1/me/computer/' + kind, json({}, intent.key)); }
    catch (error) {
      this.current(generation);
      // An explicit rejection did not enqueue our operation. Unknown transport outcomes keep the key.
      if (error instanceof HomeError && [400, 403, 404, 409, 422].includes(error.status)) {
        await this.client.setPending(); this.update({ pending: undefined, operation: undefined });
      }
      throw error;
    }
    this.current(generation);
    await this.client.setPending({ ...intent, operation: queued.operation });
    this.update({ computer: queued.computer, operation: queued.operation, pending: kind });
    return this.state;
  }
  dispose() { this.generation++; this.client.cancelRequests(); this.client.cancelLogin(); this.viewer.close(); }
}
