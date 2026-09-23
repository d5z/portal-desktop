export interface ClientWindowSnapshot {
  handle: number;
  owner: number;
  className: string;
  title: string;
  visible: boolean;
  style: number;
  extendedStyle: number;
}
export function clientWindowSnapshot(pid: number): Promise<ClientWindowSnapshot[]>;
export function isClientMainWindow(window: ClientWindowSnapshot): boolean;
export function assertSingleClientWindow(pid: number): Promise<void>;
