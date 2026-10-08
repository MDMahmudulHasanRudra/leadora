export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Raw `details` from the API: field errors for validation, structured data otherwise. */
    public readonly raw?: unknown,
  ) {
    super(message);
  }

  get details(): { path: string; message: string }[] {
    return Array.isArray(this.raw) ? this.raw : [];
  }

  fieldError(path: string): string | undefined {
    return this.details.find((d) => d.path === path)?.message;
  }
}

/** Browser-side call to the same-origin API (Caddy in Docker, Next rewrite in dev). */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong. Please try again.', e?.details);
  }
  return json as T;
}
