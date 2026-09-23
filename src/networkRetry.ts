const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const RETRY_MS = 30_000;

function networkErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" && NETWORK_ERROR_CODES.has(code) ? code : undefined;
}

/**
 * After a power outage the server can boot before the internet is back. Rather than crash into the
 * supervisor's restart cap, keep retrying startup calls until the network is up. Anything that isn't
 * a network failure (bad token, bad credentials, etc.) is rethrown immediately.
 */
export async function retryOnNetworkError<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = networkErrorCode(err);
      if (!code) throw err;
      console.warn(`${label} unreachable (${code}), retrying in ${RETRY_MS / 1000}s (attempt ${attempt})...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}
