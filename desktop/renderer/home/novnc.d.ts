declare module '@novnc/novnc/lib/rfb.js' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, channel: unknown, options: { shared: boolean });
    viewOnly: boolean; focusOnClick: boolean; scaleViewport: boolean; resizeSession: boolean;
    showDotCursor: boolean; background: string;
    disconnect(): void;
  }
}
