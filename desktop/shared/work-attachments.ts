export const workImageMime = /^image\/(png|jpeg|webp|gif)$/;
export const workImageAccept = 'image/png,image/jpeg,image/webp,image/gif';
export const deepseekUploadPath = '/api/session/uploadFileBinary';

export type DeepSeekImageRef = {
  attachmentId: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
  name?: string;
  originalDimensions?: { width: number; height: number };
};

export type WorkAttachment =
  | { type: 'image'; name: string; src: string }
  | { type: 'localImage'; name: string; path: string }
  | { type: 'executorImage'; name: string; reference: unknown }
  | { type: 'file'; name: string };
