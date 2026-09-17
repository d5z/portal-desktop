import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NotificationPreferences, NotificationSettings, NotificationTarget } from '../../shared/types';

const defaults: NotificationPreferences = { enabled: false, mail: false, firesides: false, bonfire: false };
export interface NativeNotification {
  on(event: 'click' | 'close' | 'failed', callback: () => void): unknown;
  show(): void;
  close(): void;
}
interface Options {
  supported(): boolean;
  focused(): boolean;
  create(options: { title: string; body: string }): NativeNotification;
  open(target: NotificationTarget): void;
  now?: () => number;
}

// Preferences are independent of Being credentials and can be set before pairing.
export class DesktopNotifications {
  private preferences = { ...defaults };
  private warning = '';
  private generation = -1;
  private active = new Map<NativeNotification, NotificationTarget | undefined>();
  private recent = new Map<string, number>();
  constructor(private directory: string, private options: Options) {}

  async load() {
    try {
      const saved = JSON.parse(await readFile(path.join(this.directory, 'notifications.json'), 'utf8'));
      this.preferences = this.validate(saved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.warning = '通知设置读取失败，已暂时关闭通知；重新设置后可恢复。';
    }
  }
  private validate(patch: unknown): NotificationPreferences {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('无效的通知设置。');
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(defaults, key) || typeof value !== 'boolean') throw new Error('无效的通知开关。');
    }
    return { ...this.preferences, ...patch };
  }
  get state(): NotificationSettings {
    const supported = this.options.supported();
    return { preferences: { ...this.preferences }, supported, message: this.warning || (supported
      ? '后台提醒，不展示正文。需配对 Town 并允许系统通知。'
      : '当前系统暂不支持桌面通知。') };
  }
  async save(patch: unknown) {
    const next = this.validate(patch);
    await mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, 'notifications.json');
    await writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
    await rename(file + '.tmp', file);
    this.preferences = next;
    this.warning = '';
    for (const [notification, target] of this.active) {
      if (!next.enabled || target && !next[target.channel]) this.close(notification);
    }
    return this.state;
  }
  reset(generation: number) {
    if (this.generation === generation) return;
    this.generation = generation;
    this.clear();
  }
  clear() {
    for (const notification of this.active.keys()) this.close(notification);
    this.recent.clear();
  }
  private close(notification: NativeNotification) {
    this.active.delete(notification);
    try { notification.close(); } catch { /* OS may already have dismissed it. */ }
  }
  receive(target: NotificationTarget) {
    if (!this.preferences.enabled || !this.preferences[target.channel] || !this.options.supported() || this.options.focused()) return;
    const now = (this.options.now || Date.now)();
    // Bound bursts per channel without timers or deferred notifications after disabling.
    const last = this.recent.get(target.channel);
    if (last !== undefined && now - last < 5000) return;
    this.recent.set(target.channel, now);
    const label = { mail: '私信', firesides: '围炉', bonfire: '篝火' }[target.channel];
    this.show({ title: label, body: `收到新的${label}消息，点击查看。` }, target);
  }
  test() {
    if (!this.preferences.enabled) throw new Error('请先开启桌面通知。');
    if (!this.options.supported()) throw new Error('当前系统暂不支持桌面通知。');
    if (!this.show({ title: '测试通知', body: '桌面通知已送出。你可以分别设置私信、围炉和篝火提醒。' }))
      throw new Error(this.warning);
  }
  private show(content: { title: string; body: string }, target?: NotificationTarget) {
    try {
      // Retain native objects for click callbacks, with a bounded lifetime set.
      while (this.active.size >= 20) this.close(this.active.keys().next().value!);
      const notification = this.options.create(content);
      const generation = this.generation;
      this.active.set(notification, target);
      notification.on('click', () => {
        const valid = this.active.has(notification) && generation === this.generation && this.preferences.enabled;
        this.close(notification);
        if (valid && target && this.preferences[target.channel]) this.options.open(target);
      });
      notification.on('close', () => this.active.delete(notification));
      notification.on('failed', () => {
        this.active.delete(notification);
        this.warning = '系统未能显示通知，请检查系统通知权限；Windows 请使用安装版，macOS 请使用已签名版本。';
      });
      notification.show();
      return true;
    } catch {
      this.warning = '系统未能显示通知，请检查系统通知权限和客户端安装状态。';
      return false;
    }
  }
}
