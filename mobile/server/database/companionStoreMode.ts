/** When true, companion routes use in-memory storage (no MongoDB required). */
export let useCompanionMemoryStore = false;

export function setCompanionMemoryStore(enabled: boolean): void {
  useCompanionMemoryStore = enabled;
}
