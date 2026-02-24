export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }
  if (process.env.DISABLE_AUTONOMOUS_SCHEDULER === "1") {
    return;
  }
  const { startAutonomousScheduler } = await import("@/lib/autonomous/scheduler");
  startAutonomousScheduler();
}
