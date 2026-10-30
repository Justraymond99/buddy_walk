import { performance } from "node:perf_hooks";

export type LastMileModule = "step0" | "moduleB" | "moduleC" | "moduleD" | "moduleE";
export type LastMileModuleTimings = Partial<Record<LastMileModule, number>>;

/** Independent elapsed times; a module can pause while another module runs. */
export function createLastMileModuleTimer(now = () => performance.now()) {
  const started = new Map<LastMileModule, number>();
  const durations: LastMileModuleTimings = {};
  let finished = false;

  const start = (name: LastMileModule) => {
    if (!finished && !started.has(name)) started.set(name, now());
  };
  const stop = (name: LastMileModule) => {
    const since = started.get(name);
    if (since === undefined) return;
    durations[name] = (durations[name] ?? 0) + now() - since;
    started.delete(name);
  };

  return {
    start,
    stop,
    // Close unfinished work when a trial fails or returns early. Late promise
    // callbacks must not change the timings already saved with that trial.
    finish(): LastMileModuleTimings {
      for (const name of started.keys()) stop(name);
      finished = true;
      return Object.fromEntries(Object.entries(durations).map(([name, ms]) =>
        [name, Math.round(ms * 100) / 100],
      ));
    },
  };
}
