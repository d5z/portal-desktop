import type { ChatState, ChatRuntime, RuntimeOptions } from '../models/chat';
export function createSceneRuntime(
  state: ChatState,
  options: RuntimeOptions,
  createRuntime: (state: ChatState, options: RuntimeOptions & { prepareMessage(text: string): string }) => unknown,
): ChatRuntime;
