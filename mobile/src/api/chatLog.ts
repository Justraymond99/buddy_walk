import { apiClient } from './client';
import { ChatLogInterface, MessageInterface } from '../types';

export async function createChatLog(body: ChatLogInterface) {
  try {
    const result = await apiClient.post('/db/createChatLog', body);
    return result.data;
  } catch (e) {
    console.error('createChatLog error:', e);
  }
}

export async function addChatToChatLog(body: { id: string; chat: MessageInterface }) {
  try {
    const result = await apiClient.post('/db/newChat', body);
    return result.data;
  } catch (e) {
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
