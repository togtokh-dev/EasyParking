import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
} from "./errors.js";

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface RequestOptions {
  /** Энэ хүсэлтийн timeout (мс) */
  timeout?: number;
  /** Энэ хүсэлтийн давталтын дээд тоо */
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface FinalRequest extends RequestOptions {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /**
   * Давтахад аюулгүй эсэх (§13.3). Payment/reservation confirm-ийг хэзээ ч
   * автоматаар давтахгүй — эхлээд GET-ээр төлөв шалгах ёстой (§13.2).
   */
  idempotent: boolean;
  /** {"Success": false, ...} хэлбэрийн body-г 2xx байсан ч алдаа гэж тооцох */
  envelope?: boolean;
}

export interface CoreConfig {
  apiKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
  fetch: Fetch;
  userAgent: string;
  defaultHeaders?: Record<string, string>;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export async function request<T>(cfg: CoreConfig, req: FinalRequest): Promise<T> {
  const url = buildURL(cfg.baseURL, req.path, req.query);
  const maxRetries = req.idempotent ? (req.maxRetries ?? cfg.maxRetries) : 0;
  const timeout = req.timeout ?? cfg.timeout;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": cfg.userAgent,
    ...cfg.defaultHeaders,
    ...req.headers,
    "X-API-Key": cfg.apiKey,
  };
  let body: string | undefined;
  if (req.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.body);
  }

  for (let attempt = 0; ; attempt++) {
    const retriesLeft = maxRetries - attempt;
    let response: Response;
    try {
      response = await fetchWithTimeout(cfg.fetch, url, { method: req.method, headers, body }, timeout, req.signal);
    } catch (err) {
      if (err instanceof APIUserAbortError || retriesLeft <= 0) throw err;
      await sleep(retryDelay(attempt, undefined), req.signal);
      continue;
    }

    const parsed = await readBody(response);

    if (!response.ok) {
      if (retriesLeft > 0 && RETRYABLE_STATUS.has(response.status)) {
        await sleep(retryDelay(attempt, response.headers), req.signal);
        continue;
      }
      throw APIError.from(response.status, parsed, response.headers);
    }
    if (req.envelope && isFailedEnvelope(parsed)) {
      throw APIError.from(response.status, parsed, response.headers);
    }
    return parsed as T;
  }
}

function buildURL(baseURL: string, path: string, query: FinalRequest["query"]): string {
  const url = new URL(baseURL.replace(/\/+$/, "") + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function fetchWithTimeout(
  fetchFn: Fetch,
  url: string,
  init: RequestInit,
  timeout: number,
  userSignal: AbortSignal | undefined,
): Promise<Response> {
  if (userSignal?.aborted) throw new APIUserAbortError("Хүсэлтийг зогсоосон");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  const onAbort = () => controller.abort();
  userSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new APITimeoutError(`Хүсэлт ${timeout}мс-д хариугүй: ${init.method} ${url}`, { cause: err });
    if (userSignal?.aborted) throw new APIUserAbortError("Хүсэлтийг зогсоосон", { cause: err });
    throw new APIConnectionError(`Холболтын алдаа: ${init.method} ${url}`, { cause: err });
  } finally {
    clearTimeout(timer);
    userSignal?.removeEventListener("abort", onAbort);
  }
}

/** JSON-оор задална; JSON биш (nginx-ийн 429 HTML г.м) бол текстээр нь. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isFailedEnvelope(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.Success === false || b.success === false;
}

/** Retry-After-ийг дагана, эс бол 0.5с·2^n (8с дээд) + jitter. */
function retryDelay(attempt: number, headers: Headers | undefined): number {
  const retryAfter = headers?.get("retry-after");
  if (retryAfter) {
    const secs = Number(retryAfter);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(retryAfter) - Date.now();
    if (ms > 0 && ms <= 60_000) return ms;
  }
  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base * (0.75 + Math.random() * 0.25);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new APIUserAbortError("Хүсэлтийг зогсоосон"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new APIUserAbortError("Хүсэлтийг зогсоосон"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
