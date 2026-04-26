/**
 * Paginated GET helper for `/api/v1/*` list endpoints.
 *
 * v1 list responses are `{ data: T[], nextCursor: string | null }`. Callers
 * that want every row (not just a page) must follow the cursor. Legacy
 * `/api/agents`, `/api/skills` etc. returned all rows unbounded, so naive
 * migration to `?limit=200` silently truncates at 200. This helper follows
 * the cursor until exhausted.
 *
 * Guardrails:
 * - `maxPages` (default 50) caps pathological loops (50 × limit=200 = 10k rows).
 * - Non-2xx responses throw with the v1 error message.
 */
export interface V1ListPage<T> {
  data: T[];
  nextCursor: string | null;
}

export async function fetchAllV1<T>(
  basePath: string,
  opts: { limit?: number; maxPages?: number; signal?: AbortSignal } = {}
): Promise<T[]> {
  const limit = opts.limit ?? 100;
  const maxPages = opts.maxPages ?? 50;
  const out: T[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const u = new URL(basePath, window.location.origin);
    u.searchParams.set('limit', String(limit));
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u.pathname + u.search, { signal: opts.signal });
    const json = (await res.json().catch(() => null)) as V1ListPage<T> & {
      error?: { code?: string; message?: string };
    };
    if (!res.ok) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    out.push(...(json?.data ?? []));
    cursor = json?.nextCursor ?? null;
    if (!cursor) return out;
  }
  // Hit maxPages without exhausting the cursor — surface a warning so devs
  // see it, but return what we have rather than throwing.
  if (typeof console !== 'undefined') {
    console.warn(
      `fetchAllV1(${basePath}): hit maxPages=${maxPages} with cursor still set; truncating at ${out.length} rows.`
    );
  }
  return out;
}
