export function explainFetchError(action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(detail)) {
    return new Error(
      `${action} failed to download. Use http://localhost:5173 and check your network, then try again.`,
    );
  }
  return error instanceof Error ? error : new Error(detail);
}
