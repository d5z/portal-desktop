export type WorkExecutorCapabilities = {
  attachments?: 'image' | 'file';
  steerAttachments?: boolean;
  models?: boolean;
  steer?: boolean;
  connect?: boolean;
};

export type WorkAgentDescriptor = {
  id: string;
  name: string;
  available: boolean;
  canExecute?: boolean;
  message?: string;
  capabilities?: WorkExecutorCapabilities;
};

export type WorkAgentConnection = WorkAgentDescriptor & {
  enabled?: boolean;
  diagnostic?: 'unavailable' | 'error';
};
