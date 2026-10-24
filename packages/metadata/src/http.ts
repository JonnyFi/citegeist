/**
 * The one HTTP client all resolvers use: response cache, per-source rate limits, retries with
 * backoff, and an injectable fetch (tests replay recorded responses, nothing touches the network).
 */

import { SourceError } from "./types.js";

export interface RateLimit {
  /** Minimum time between the starts of two requests. */
  minIntervalMs: number;
  /** Maximum requests in flight. */
  concurrency: number;
}

/** Limits per source from docs/research/metadata-sources.md section 12. */
export const DEFAULT_LIMITS: Record<string, RateLimit> = {
  // Crossref polite pool: 10/s single, 3 concurrent. The public pool allows 5/s with one in flight.
  crossref: { minIntervalMs: 120, concurrency: 1 },
  "crossref-list": { minIntervalMs: 400, concurrency: 1 },
  "doi.org": { minIntervalMs: 120, concurrency: 1 },
  openalex: { minIntervalMs: 100, concurrency: 2 },
  // NCBI E-utilities: 3 requests per second without a key (10 with one, see resolver).
  ncbi: { minIntervalMs: 350, concurrency: 1 },
  // Unpaywall asks for at most 100,000 calls a day.
  unpaywall: { minIntervalMs: 100, concurrency: 2 },
  // arXiv terms: one request every three seconds, one connection at a time.
  arxiv: { minIntervalMs: 3000, concurrency: 1 },
  dnb: { minIntervalMs: 1000, concurrency: 1 },
  k10plus: { minIntervalMs: 1000, concurrency: 1 },
  openlibrary: { minIntervalMs: 500, concurrency: 1 },
};

export interface HttpRequest {
  /** Rate limit bucket, normally the source name. */
  source: string;
  url: string;
  accept?: string;
  headers?: Record<string, string>;
  /** Cache lifetime. Default 30 days for hits, one day for 404. */
  ttlMs?: number;
  /** Skip the cache for this request. */
  noCache?: boolean;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
  contentType: string;
  /** Unix ms when the body was fetched (not when it was read from the cache). */
  fetchedAt: number;
  fromCache: boolean;
}

export interface CacheEntry {
  status: number;
  body: string;
  contentType: string;
  fetchedAt: number;
  expiresAt: number;
}

/** Plug in a SQLite implementation in the core. The metadata package only needs get and set. */
export interface HttpCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

export class MemoryHttpCache implements HttpCache {
  private readonly map = new Map<string, CacheEntry>();
  async get(key: string): Promise<CacheEntry | undefined> {
    return this.map.get(key);
  }
  async set(key: string, entry: CacheEntry): Promise<void> {
    this.map.set(key, entry);
  }
  get size(): number {
    return this.map.size;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  fetch?: FetchLike;
  cache?: HttpCache;
  limits?: Record<string, RateLimit>;
  userAgent?: string;
  /** Extra attempts after the first one for 429, 5xx and network errors. Default 3. */
  maxRetries?: number;
  /** Base of the exponential backoff. Default 1000 ms. */
  backoffMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const SECRET_PARAMS = ["mailto", "email", "api_key", "apikey", "key", "tool"];
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const DAY = 24 * 60 * 60 * 1000;

/**
 * URL used for cache keys and fixture lookup: identifying parameters (mailto, API keys) are
 * removed so a cache or a recording never depends on, or leaks, who made the request.
 */
export function keyUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  for (const p of SECRET_PARAMS) u.searchParams.delete(p);
  u.searchParams.sort();
  return u.toString();
}

export function cacheKey(source: string, url: string, accept?: string): string {
  return `${source}\nGET\n${keyUrl(url)}\n${accept ?? ""}`;
}

class Limiter {
  private nextStart = 0;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly limit: RateLimit,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }

  private async acquire(): Promise<void> {
    while (this.active >= this.limit.concurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    // Reserve the slot synchronously so concurrent callers queue behind each other.
    const start = Math.max(this.now(), this.nextStart);
    this.nextStart = start + this.limit.minIntervalMs;
    const wait = start - this.now();
    if (wait > 0) await this.sleep(wait);
  }
}

export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly cache: HttpCache;
  private readonly limiters = new Map<string, Limiter>();
  private readonly opts: Required<
    Pick<HttpClientOptions, "maxRetries" | "backoffMs" | "timeoutMs" | "userAgent">
  >;
  private readonly limits: Record<string, RateLimit>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: HttpClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.cache = options.cache ?? new MemoryHttpCache();
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.opts = {
      maxRetries: options.maxRetries ?? 3,
      backoffMs: options.backoffMs ?? 1000,
      timeoutMs: options.timeoutMs ?? 30_000,
      userAgent: options.userAgent ?? "citegeist",
    };
  }

  async get(req: HttpRequest): Promise<HttpResponse> {
    const key = cacheKey(req.source, req.url, req.accept);
    if (!req.noCache) {
      const hit = await this.cache.get(key);
      if (hit && hit.expiresAt > this.now()) {
        return {
          status: hit.status,
          ok: hit.status >= 200 && hit.status < 300,
          body: hit.body,
          contentType: hit.contentType,
          fetchedAt: hit.fetchedAt,
          fromCache: true,
        };
      }
    }

    const res = await this.fetchWithRetry(req);
    // Only cache answers that will stay true: hits and plain 404s.
    if (!req.noCache && (res.ok || res.status === 404)) {
      const ttl = res.ok ? (req.ttlMs ?? 30 * DAY) : DAY;
      await this.cache.set(key, {
        status: res.status,
        body: res.body,
        contentType: res.contentType,
        fetchedAt: res.fetchedAt,
        expiresAt: this.now() + ttl,
      });
    }
    return res;
  }

  private limiter(source: string): Limiter {
    let l = this.limiters.get(source);
    if (!l) {
      const limit = this.limits[source] ?? { minIntervalMs: 200, concurrency: 1 };
      l = new Limiter(limit, this.now, this.sleep);
      this.limiters.set(source, l);
    }
    return l;
  }

  private async fetchWithRetry(req: HttpRequest): Promise<HttpResponse> {
    const limiter = this.limiter(req.source);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      let retryAfterMs: number | undefined;
      try {
        const res = await limiter.run(() => this.once(req));
        if (!RETRY_STATUS.has(res.status) || attempt === this.opts.maxRetries) return res.response;
        retryAfterMs = res.retryAfterMs;
        lastError = new SourceError(req.source, `HTTP ${res.status}`, res.status);
      } catch (err) {
        lastError = err;
        if (attempt === this.opts.maxRetries) break;
      }
      const backoff = this.opts.backoffMs * 2 ** attempt * (0.75 + this.random() * 0.5);
      await this.sleep(retryAfterMs !== undefined ? Math.max(retryAfterMs, backoff) : backoff);
    }
    if (lastError instanceof SourceError) throw lastError;
    throw new SourceError(
      req.source,
      `network error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private async once(
    req: HttpRequest,
  ): Promise<{ status: number; response: HttpResponse; retryAfterMs: number | undefined }> {
    const headers: Record<string, string> = {
      "User-Agent": this.opts.userAgent,
      ...(req.accept ? { Accept: req.accept } : {}),
      ...req.headers,
    };
    const res = await this.fetchImpl(req.url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    const body = await res.text();
    return {
      status: res.status,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), this.now()),
      response: {
        status: res.status,
        ok: res.ok,
        body,
        contentType: res.headers.get("content-type") ?? "",
        fetchedAt: this.now(),
        fromCache: false,
      },
    };
  }
}

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
