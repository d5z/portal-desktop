export const DEFAULT_CHAT_HISTORY_LIMIT = 100;
export const MAX_CHAT_HISTORY_LIMIT = 1000;
export const CHAT_HISTORY_LIMIT_KEY = 'beings:chat-history-limit';

export function validChatHistoryLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_CHAT_HISTORY_LIMIT;
}

export function chatHistoryLimit(value: unknown): number {
  return validChatHistoryLimit(value) ? value : DEFAULT_CHAT_HISTORY_LIMIT;
}
