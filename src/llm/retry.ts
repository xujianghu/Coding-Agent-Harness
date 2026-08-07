export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000 } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      if (isNonRetryable(error)) throw error;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

function isNonRetryable(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;

    if (typeof err.status === 'number') {
      const status = err.status;
      if (status === 400 || status === 401 || status === 403) {
        return true;
      }
    }

    if (typeof err.name === 'string') {
      const name = err.name;
      if (name === 'AuthenticationError' || name === 'PermissionDeniedError') {
        return true;
      }
    }
  }
  return false;
}