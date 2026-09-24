import type { ChatState, ChatRuntime, RuntimeOptions } from '../models/chat';
export function createSceneRuntime(
  state: ChatState,
  options: RuntimeOptions,
  createRuntime: (state: ChatState, options: RuntimeOptions & {
    prepareMessage(text: string): string;
    prepareRequestMessage(text: string, scene: import('../models/scenes').MessageScene, sendOptions?: { queuedMessage?: unknown }): string;
  }) => unknown,
): ChatRuntime;
