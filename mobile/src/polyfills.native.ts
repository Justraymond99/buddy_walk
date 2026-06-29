/**
 * Hermes has no browser `Event` global; some transitive deps reference it at load time.
 * Install a minimal stub before the rest of the app imports run.
 */
const g = globalThis as typeof globalThis & { Event?: typeof Event };

if (typeof g.Event === 'undefined') {
  class EventPolyfill {
    readonly type: string;
    bubbles = false;
    cancelable = false;
    defaultPrevented = false;

    constructor(type: string) {
      this.type = type;
    }

    preventDefault(): void {
      this.defaultPrevented = true;
    }

    stopPropagation(): void {}
    stopImmediatePropagation(): void {}
  }

  g.Event = EventPolyfill as unknown as typeof Event;
}
