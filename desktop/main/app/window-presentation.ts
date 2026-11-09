import type { BrowserWindow } from 'electron';

const presentations = new WeakMap<BrowserWindow, WindowPresentation>();

/** One visibility intent per native window, shared by close, activation and quit. */
export function windowPresentation(window: BrowserWindow) {
  let presentation = presentations.get(window);
  if (!presentation) {
    presentation = new WindowPresentation(window);
    presentations.set(window, presentation);
  }
  return presentation;
}

class WindowPresentation {
  private fullScreen = false;
  private leaving?: Promise<void>;
  private intent: 'show' | 'hide' | 'quit' = 'show';
  private fullScreenable?: boolean;
  private resizable: boolean;

  constructor(private window: BrowserWindow) {
    this.resizable = window.isResizable();
    // isFullScreen can already be false during the native exit animation.
    window.on('enter-full-screen', () => { this.fullScreen = true; });
    window.on('leave-full-screen', () => { this.fullScreen = false; });
  }

  show() {
    if (this.intent === 'quit' || this.window.isDestroyed()) return;
    this.intent = 'show';
    if (this.leaving) return; // The pending hide applies the latest intent.
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }

  async hide() {
    if (this.intent === 'quit' || this.intent === 'hide') return;
    this.intent = 'hide';
    const leaving = this.leaveFullScreen();
    if (leaving) await leaving;
    if (this.window.isDestroyed()) return;
    if (this.intent === 'hide') this.window.hide();
    else if (this.intent === 'show') this.show();
  }

  async prepareForQuit() {
    this.intent = 'quit';
    const leaving = this.leaveFullScreen();
    if (leaving) await leaving;
    if (process.platform === 'darwin' && !this.window.isDestroyed() && this.fullScreenable === undefined) {
      // Do not let a new fullscreen transition start during service cleanup.
      this.fullScreenable = this.window.isFullScreenable();
      this.window.setFullScreenable(false);
    }
  }

  cancelQuit() {
    this.intent = 'show';
    if (this.window.isDestroyed()) return;
    if (this.fullScreenable !== undefined) {
      this.window.setFullScreenable(this.fullScreenable);
      this.fullScreenable = undefined;
    }
    // Preparing quit never hides windows; preserve hidden context/plugin windows.
  }

  private leaveFullScreen(): Promise<void> | undefined {
    if (this.leaving) return this.leaving;
    const window = this.window;
    if (process.platform !== 'darwin' || window.isDestroyed()) return;
    // Electron/macOS reports a normally resizable window as non-resizable during
    // fullscreen transitions, including entry before isFullScreen becomes true.
    const transitioning = this.resizable && !window.isResizable();
    if (!(this.fullScreen || window.isFullScreen() || transitioning)) return;
    this.leaving = new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        window.removeListener('leave-full-screen', left);
        window.removeListener('closed', left);
        // Electron drains deferred close requests after the native event.
        setImmediate(() => { this.leaving = undefined; error ? reject(error) : resolve(); });
      };
      const left = () => finish();
      // A missing native event must fail the operation, not leave quit pending forever.
      const timeout = setTimeout(() => finish(new Error('退出 macOS 全屏未完成，请退出全屏后重试。')), 10_000);
      window.once('leave-full-screen', left);
      window.once('closed', left);
    });
    window.setFullScreen(false);
    return this.leaving;
  }
}
