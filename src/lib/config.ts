export function isTrainingMode(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("train") === "1" || params.get("training") === "1") {
      return true;
    }
  } catch {
    // window may be unavailable in non-browser contexts; fall through to env.
  }
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_TRAINING === "1";
}
