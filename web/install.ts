type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export type InstallPlatform = "ios" | "android" | "mac-safari" | "desktop";
export function installPlatform(
  navigator: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
): InstallPlatform {
  if (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
    return "ios";
  if (/Android/.test(navigator.userAgent)) return "android";
  if (
    /Mac/.test(navigator.platform) &&
    /Safari/.test(navigator.userAgent) &&
    !/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent)
  )
    return "mac-safari";
  return "desktop";
}

/** Keep the browser's single-use prompt even before the settings page is opened. */
export class InstallController {
  private deferred?: InstallPrompt;
  private listeners = new Set<() => void>();
  private display: MediaQueryList;
  private state: { installed: boolean; available: boolean; busy: boolean };
  readonly platform: InstallPlatform;
  readonly secure: boolean;
  constructor(private host: Window) {
    this.platform = installPlatform(host.navigator);
    this.secure = host.isSecureContext;
    this.display = host.matchMedia(
      "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)",
    );
    this.state = {
      installed: this.standalone(),
      available: false,
      busy: false,
    };
  }
  private standalone = () =>
    this.display.matches ||
    (this.host.navigator as Navigator & { standalone?: boolean }).standalone ===
      true;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  start() {
    const ready = (event: Event) => {
      if (
        typeof (event as InstallPrompt).prompt !== "function" ||
        this.state.installed
      )
        return;
      event.preventDefault();
      this.deferred = event as InstallPrompt;
      this.update({ available: true });
    };
    const installed = () => {
      this.deferred = undefined;
      this.update({ installed: true, available: false, busy: false });
    };
    const display = () => {
      if (this.standalone()) installed();
      else this.update({ installed: false });
    };
    this.host.addEventListener("beforeinstallprompt", ready);
    this.host.addEventListener("appinstalled", installed);
    this.display.addEventListener("change", display);
    return () => {
      this.host.removeEventListener("beforeinstallprompt", ready);
      this.host.removeEventListener("appinstalled", installed);
      this.display.removeEventListener("change", display);
    };
  }
  async install(): Promise<
    "accepted" | "dismissed" | "guide" | "busy" | "installed"
  > {
    if (this.state.installed) return "installed";
    if (this.state.busy) return "busy";
    const event = this.deferred;
    if (!event) return "guide";
    this.deferred = undefined;
    this.update({ available: false, busy: true });
    try {
      // Invoke synchronously in the click handler to retain user activation.
      await event.prompt();
      return (await event.userChoice).outcome;
    } catch {
      return "guide";
    } finally {
      this.update({ busy: false });
    }
  }
}
