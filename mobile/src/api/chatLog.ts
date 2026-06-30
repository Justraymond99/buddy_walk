import { apiClient } from './client';
import { ChatLogInterface, MessageInterface } from '../types';

function isUnreachableApiError(e: unknown): boolean {
  const err = e as { message?: string; code?: string };
  return err?.message === 'Network Error' || err?.code === 'ECONNABORTED';
}

export async function createChatLog(body: ChatLogInterface) {
  try {
    const result = await apiClient.post('/db/createChatLog', body);
    return result.data;
  } catch (e) {
    // Chat logging is best-effort; unreachable API should not spam LogBox after voice Q&A.
    if (isUnreachableApiError(e)) {
      if (__DEV__) console.warn('createChatLog: API unreachable (chat not saved)');
      return;
    }
    console.error('createChatLog error:', e);
  }
}

export async function addChatToChatLog(body: { id: string; chat: MessageInterface }) {
  try {
    const result = await apiClient.post('/db/newChat', body);
    return result.data;
  } catch (e) {
    if (isUnreachableApiError(e)) {
      if (__DEV__) console.warn('addChatToChatLog: API unreachable (chat not saved)');
      return;
    }
    console.error('addChatToChatLog error:', e);
  }
}

export async function flagMessage(body: {
  flagReason?: string;
  messageId: string;
  chatlogId: string;
}) {
  try {
    const result = await apiClient.post('/db/flagMessage', body);
    return result.data;
  } catch (e) {
    console.error('flagMessage error:', e);
  }
}
