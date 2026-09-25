import "server-only";

import { CourierAdapterError } from "@snapduka/core";

/**
 * JSON-over-HTTPS transport shared by partner adapters.
 *
 * The part of an integration that is the same for every partner — auth header,
 * idempotency header, timeout, and turning HTTP failures into the adapter error
 * codes the aggregator and booking route understand — lives here, so a new
 * partner adapter is only its request/response mapping.
 */

export type HttpTransportOptions = {
  courierId: string;
  baseUrl: string;
  /** Sent as `Authorization: Bearer <apiKey>` unless `authHeader` overrides. */
  apiKey: string;
  authHeader?: (apiKey: string) => Record<string, string>;
  /** Header the partner reads an idempotency key from, if it supports one. */
  idempotencyHeader?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type HttpTransport = {
  postJson<T>(
    path: string,
    body: unknown,
    options?: { signal?: AbortSignal; idempotencyKey?: string },
  ): Promise<T>;
  getJson<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>;
};

const DEFAULT_TIMEOUT_MS = 10_000;

export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = options.baseUrl.replace(/\/+$/, "");
  const authHeaders =
    options.authHeader?.(options.apiKey) ?? { authorization: `Bearer ${options.apiKey}` };

  async function send<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    idempotencyKey: string | undefined,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers: Record<string, string> = {
      accept: "application/json",
      ...authHeaders,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey && options.idempotencyHeader) {
      headers[options.idempotencyHeader] = idempotencyKey;
    }

    let response: Response;
    try {
      response = await fetchImpl(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      throw new CourierAdapterError(
        options.courierId,
        aborted ? "timeout" : "unavailable",
        aborted ? "The courier did not answer in time." : "The courier could not be reached.",
      );
    }

    if (!response.ok) {
      // 4xx is the partner refusing this request; retrying the same request
      // will be refused again. 429 and 5xx are the partner having a bad minute.
      const retryable = response.status === 429 || response.status >= 500;
      throw new CourierAdapterError(
        options.courierId,
        retryable ? "unavailable" : "rejected",
        `Courier responded ${response.status}.`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    postJson: (path, body, opts) => send("POST", path, body, opts?.signal, opts?.idempotencyKey),
    getJson: (path, opts) => send("GET", path, undefined, opts?.signal, undefined),
  };
}
