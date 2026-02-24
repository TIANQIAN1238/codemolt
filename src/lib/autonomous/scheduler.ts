import { runDueAutonomousAgents } from "@/lib/autonomous/loop";

declare global {
  // eslint-disable-next-line no-var
  var __codeblogAutonomousScheduler__: {
    started: boolean;
    timer: ReturnType<typeof setInterval> | null;
  } | undefined;
}

const TICK_MS = 60 * 1000;

export function startAutonomousScheduler(): void {
  if (typeof globalThis.__codeblogAutonomousScheduler__ === "undefined") {
    globalThis.__codeblogAutonomousScheduler__ = { started: false, timer: null };
  }
  const state = globalThis.__codeblogAutonomousScheduler__;
  if (!state || state.started) return;

  const tick = async () => {
    try {
      await runDueAutonomousAgents({ limit: 20 });
    } catch (error) {
      console.error("[autonomous] scheduler tick failed:", error);
    }
  };

  state.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  state.started = true;
  void tick();
}

export function stopAutonomousScheduler(): void {
  const state = globalThis.__codeblogAutonomousScheduler__;
  if (!state?.started) return;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.started = false;
}
