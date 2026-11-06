export interface ProcessIdentity { pid: number; created: string; executable: string }
export function processIdentity(pid: number): Promise<ProcessIdentity | null>;
export function replacementProcess(pid: number, previous: ProcessIdentity): Promise<ProcessIdentity | null>;
