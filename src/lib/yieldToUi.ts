export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const scheduler = (
      globalThis as typeof globalThis & {
        scheduler?: { yield?: () => Promise<void> };
      }
    ).scheduler;
    const afterYield = () => requestAnimationFrame(() => resolve());
    if (typeof scheduler?.yield === "function") {
      void scheduler.yield().then(afterYield, afterYield);
      return;
    }
    setTimeout(afterYield, 0);
  });
}
