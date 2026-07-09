import { history } from "../types";

const MAX_HISTORY = 20;
const store = new Map<string, history[]>();

type AnalyticsIds = {
  installId?: string;
  sessionId?: string;
  conversationId?: string;
  resetHistory?: boolean;
};

function historyKey(analytics?: AnalyticsIds): string {
  const install = analytics?.installId?.trim() || "anonymous";
  const conversation =
    analytics?.conversationId?.trim() ||
    analytics?.sessionId?.trim() ||
    "default";
  return `${install}:${conversation}`;
}

export function getConversationHistory(analytics?: AnalyticsIds): history[] {
  if (analytics?.resetHistory) {
    clearConversationHistory(analytics);
    return [];
  }
  return [...(store.get(historyKey(analytics)) ?? [])];
}

export function appendConversationHistory(
  analytics: AnalyticsIds | undefined,
  entry: history
): history[] {
  const key = historyKey(analytics);
  const list = [...(store.get(key) ?? [])];
  list.push(entry);
  while (list.length > MAX_HISTORY) list.shift();
  store.set(key, list);
  return list;
}

export function clearConversationHistory(analytics?: AnalyticsIds): void {
  store.delete(historyKey(analytics));
}

export function formatHistoryForPrompt(entries: history[]): string {
  if (entries.length === 0) return "(none — fresh test session)";
  return entries
    .map(
      (h) =>
        `User Input: ${h.input}, AI Output: ${h.output}, Data Used: ${h.data}`
    )
    .join("\n");
}
