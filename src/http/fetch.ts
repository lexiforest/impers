/**
 * Fetch API compatible interface
 *
 * Provides a standard Fetch API (`fetch()`) wrapper around impers' HTTP engine.
 * The input (`input`/`init`) follows the global Fetch types (undici-types), and
 * the return value is a global `Response`. impers-specific extensions are added
 * on top of `RequestInit` via {@link ImpersRequestInit}.
 *
 * Limitations inherited from the global `Response` public constructor:
 * - `response.url` is always `""` (final URL is not exposed).
 * - `response.redirected` is always `false`.
 * - `response.type` is always `"default"`.
 * The `status`, `statusText`, `headers` and body (`text()`/`json()`/`arrayBuffer()`)
 * are accurate.
 *
 * Unsupported standard `RequestInit` fields are silently ignored:
 * `credentials`, `mode`, `integrity`, `keepalive`, `window`, `duplex`,
 * `referrerPolicy`, `referrer`.
 */

import { Session } from "./session.js";
import { Headers as ImpersHeaders, type HeadersInit as ImpersHeadersInit } from "./headers.js";
import { RequestException } from "../utils/errors.js";
import type {
  RequestOptions,
  MultipartField,
  ProxyConfig,
  BasicAuth,
  AuthType,
  CertConfig,
  ExtraFingerprint,
} from "../types/options.js";
import type { CookiesInit } from "./cookies.js";

// Note: global Request/Response/Headers/BodyInit/HeadersInit/RequestInit are
// NOT imported here. They resolve via the global type scope (@types/node ->
// web-globals/fetch.d.ts). Referencing them unqualified points at the global
// types, avoiding name clashes with impers' own Request/Response/Headers.

/**
 * impers extension of the standard {@link RequestInit}.
 *
 * Standard Fetch fields (`method`, `headers`, `body`, `signal`, `redirect`,
 * `integrity`, `credentials`, `mode`, `referrer`, `referrerPolicy`, `window`,
 * `keepalive`, `duplex`) are inherited from `RequestInit` and not redefined.
 *
 * The following standard fields are currently ignored:
 * `credentials`, `mode`, `integrity`, `keepalive`, `window`, `duplex`,
 * `referrerPolicy`, `referrer`.
 *
 * `maxRedirects` defaults to 20 (Fetch standard) rather than impers' usual 30.
 */
export interface ImpersRequestInit extends RequestInit {
  /** Query string parameters */
  params?: Record<string, string | number | boolean | (string | number | boolean)[]> | URLSearchParams;
  /** Browser to impersonate (e.g. "chrome124", "firefox120") */
  impersonate?: string;
  /** JA3 fingerprint string */
  ja3?: string;
  /** Akamai HTTP/2 fingerprint */
  akamai?: string;
  /** Extra fingerprint options */
  extraFp?: ExtraFingerprint;
  /** Default headers when impersonating (default: true) */
  defaultHeaders?: boolean;
  /** Proxy URL (applies to all protocols) */
  proxy?: string;
  /** Protocol-specific proxies */
  proxies?: ProxyConfig;
  /** Proxy authentication */
  proxyAuth?: BasicAuth;
  /** HTTP authentication */
  auth?: AuthType;
  /** Verify SSL certificates (default: true) */
  verify?: boolean;
  /** CA certificate bundle path */
  caCert?: string;
  /** Client certificate */
  cert?: string | CertConfig;
  /** Total request timeout in seconds */
  timeout?: number;
  /** Connection timeout in seconds */
  connectTimeout?: number;
  /** Read timeout in seconds */
  readTimeout?: number;
  /** Maximum number of redirects (default: 20, Fetch standard) */
  maxRedirects?: number;
  /** Force specific HTTP version */
  httpVersion?: "1.0" | "1.1" | "2" | "3";
  /** Network interface to use */
  interface?: string;
  /** Local address to bind to */
  localAddress?: string;
  /** Local port to bind to */
  localPort?: number;
  /** DNS servers to use */
  dnsServers?: string[];
  /** DNS-over-HTTPS URL */
  dohUrl?: string;
  /** User-Agent header */
  userAgent?: string;
  /** Accept-Encoding header (default: "gzip, deflate, br") */
  acceptEncoding?: string;
  /** Decode response content automatically (default: true) */
  decodeContent?: boolean;
  /** Referer header */
  referer?: string;
  /** Request cookies */
  cookies?: CookiesInit;
  /** Raw curl options to set (escape hatch) */
  curlOptions?: Record<number, unknown>;
}

/** Default max redirects, aligned with the Fetch standard (20). */
const DEFAULT_MAX_REDIRECTS = 20;

/**
 * Resolve the fetch `input` into a URL string, method and a partial init.
 *
 * When `input` is a global `Request`, its method/headers/body/signal/redirect
 * are extracted and used to fill in fields missing from `init`.
 *
 * @returns the resolved URL and the effective init to use.
 */
async function resolveInput(
  input: string | URL | Request,
  init: ImpersRequestInit | undefined,
): Promise<{ url: string; init: ImpersRequestInit }> {
  if (typeof input === "string") {
    return { url: input, init: init ?? {} };
  }

  if (input instanceof URL) {
    return { url: input.href, init: init ?? {} };
  }

  // Global Request: pull fields not overridden by init.
  const merged: ImpersRequestInit = { ...init };

  if (merged.method === undefined) {
    merged.method = input.method;
  }
  if (merged.redirect === undefined) {
    merged.redirect = input.redirect;
  }
  if (merged.signal === undefined) {
    merged.signal = input.signal;
  }
  if (merged.headers === undefined) {
    merged.headers = input.headers;
  }
  if (merged.body === undefined && !input.bodyUsed) {
    // Reading the Request body may be async (Blob/FormData etc.).
    merged.body = await input.arrayBuffer();
  }

  return { url: input.url, init: merged };
}

/**
 * Convert a global `HeadersInit` into impers' `HeadersInit`.
 *
 * The global `Headers` is `Iterable<[string, string]>`, but impers' `Headers`
 * constructor does not recognize a global `Headers` instance (it only checks
 * its own class), so a global `Headers` is materialized into an entries array
 * that impers' `Headers` accepts. Records and string arrays pass through.
 */
function convertHeadersInitToImpers(init: HeadersInit | undefined): ImpersHeadersInit | undefined {
  if (init === undefined) {
    return undefined;
  }
  if (typeof Headers !== "undefined" && init instanceof Headers) {
    return Array.from(init.entries());
  }
  return init as unknown as ImpersHeadersInit;
}

/**
 * Convert impers' `Headers` into a global `Headers`.
 */
function convertImpersHeadersToGlobal(headers: ImpersHeaders): Headers {
  return new Headers(Array.from(headers.entries()));
}

/**
 * Convert a global `BodyInit` into impers' `RequestOptions` body fields.
 *
 * Sets `content`, `data` or `multipart` on the options object as appropriate.
 */
async function convertBody(body: BodyInit, options: RequestOptions): Promise<void> {
  if (body === null || body === undefined) {
    return;
  }

  if (typeof body === "string") {
    options.content = body;
    return;
  }

  // ArrayBufferView (Buffer/Uint8Array/TypedArray/DataView)
  if (ArrayBuffer.isView(body)) {
    const view = body as NodeJS.ArrayBufferView;
    options.content = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    return;
  }

  if (body instanceof ArrayBuffer) {
    options.content = Buffer.from(new Uint8Array(body));
    return;
  }

  if (body instanceof URLSearchParams) {
    options.data = body;
    return;
  }

  // Blob (Node's buffer.Blob or undici Blob)
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    options.content = Buffer.from(await body.arrayBuffer());
    return;
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    options.multipart = await convertFormData(body);
    return;
  }

  // Iterable<Uint8Array> / AsyncIterable<Uint8Array>
  const asyncIterable = body as AsyncIterable<Uint8Array>;
  if (typeof asyncIterable[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of asyncIterable) {
      chunks.push(Buffer.from(chunk));
    }
    options.content = Buffer.concat(chunks);
    return;
  }

  const iterable = body as Iterable<Uint8Array>;
  if (typeof iterable[Symbol.iterator] === "function") {
    const chunks: Buffer[] = [];
    for (const chunk of iterable) {
      chunks.push(Buffer.from(chunk));
    }
    options.content = Buffer.concat(chunks);
    return;
  }

  throw new TypeError("Unsupported body type for fetch()");
}

/**
 * Convert a global `FormData` into impers `MultipartField[]`.
 */
async function convertFormData(formData: FormData): Promise<MultipartField[]> {
  const fields: MultipartField[] = [];

  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") {
      fields.push({ name, value });
      continue;
    }

    // File (a subtype of Blob with name)
    const file = value as File;
    const data = Buffer.from(await value.arrayBuffer());
    fields.push({
      name,
      value: data,
      filename: file.name,
      contentType: value.type || undefined,
    });
  }

  return fields;
}

/**
 * Convert an {@link ImpersRequestInit} into impers' {@link RequestOptions} plus
 * the effective HTTP method and redirect mode.
 *
 * @returns options, method, and the redirect mode (`follow`/`error`/`manual`).
 */
function convertInit(init: ImpersRequestInit): {
  options: RequestOptions;
  method: string;
  redirect: RequestRedirect;
} {
  const options: RequestOptions = {};

  // Headers
  if (init.headers !== undefined) {
    options.headers = convertHeadersInitToImpers(init.headers);
  }

  // signal
  if (init.signal !== undefined) {
    options.signal = init.signal ?? undefined;
  }

  // redirect handling
  const redirect: RequestRedirect = init.redirect ?? "follow";
  if (redirect === "follow") {
    options.allowRedirects = true;
    options.maxRedirects = init.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  } else {
    // "error" and "manual" both disable following; "error" throws on 3xx after.
    options.allowRedirects = false;
  }

  // impers extension fields
  if (init.params !== undefined) options.params = init.params;
  if (init.impersonate !== undefined) options.impersonate = init.impersonate;
  if (init.ja3 !== undefined) options.ja3 = init.ja3;
  if (init.akamai !== undefined) options.akamai = init.akamai;
  if (init.extraFp !== undefined) options.extraFp = init.extraFp;
  if (init.defaultHeaders !== undefined) options.defaultHeaders = init.defaultHeaders;
  if (init.proxy !== undefined) options.proxy = init.proxy;
  if (init.proxies !== undefined) options.proxies = init.proxies;
  if (init.proxyAuth !== undefined) options.proxyAuth = init.proxyAuth;
  if (init.auth !== undefined) options.auth = init.auth;
  if (init.verify !== undefined) options.verify = init.verify;
  if (init.caCert !== undefined) options.caCert = init.caCert;
  if (init.cert !== undefined) options.cert = init.cert;
  if (init.timeout !== undefined) options.timeout = init.timeout;
  if (init.connectTimeout !== undefined) options.connectTimeout = init.connectTimeout;
  if (init.readTimeout !== undefined) options.readTimeout = init.readTimeout;
  if (init.httpVersion !== undefined) options.httpVersion = init.httpVersion;
  if (init.interface !== undefined) options.interface = init.interface;
  if (init.localAddress !== undefined) options.localAddress = init.localAddress;
  if (init.localPort !== undefined) options.localPort = init.localPort;
  if (init.dnsServers !== undefined) options.dnsServers = init.dnsServers;
  if (init.dohUrl !== undefined) options.dohUrl = init.dohUrl;
  if (init.userAgent !== undefined) options.userAgent = init.userAgent;
  if (init.acceptEncoding !== undefined) options.acceptEncoding = init.acceptEncoding;
  if (init.decodeContent !== undefined) options.decodeContent = init.decodeContent;
  if (init.referer !== undefined) options.referer = init.referer;
  if (init.cookies !== undefined) options.cookies = init.cookies;
  if (init.curlOptions !== undefined) options.curlOptions = init.curlOptions;

  const method = init.method ?? "GET";

  return { options, method, redirect };
}

/**
 * Fetch a resource, returning a standard global `Response`.
 *
 * This mirrors the global Fetch API while exposing impers' impersonation and
 * transport options via {@link ImpersRequestInit}.
 *
 * - Network errors (connection/DNS/SSL/timeout/abort) are re-thrown as
 *   `TypeError` with the original impers exception preserved in `cause`.
 * - 4xx/5xx responses are returned (not rejected), matching Fetch semantics.
 * - `response.url`/`response.redirected` are not populated (constructor limit).
 *
 * @param input - A URL string, `URL`, or global `Request`.
 * @param init - Standard `RequestInit` plus impers extensions.
 * @returns A global `Response`.
 *
 * @example
 * ```ts
 * const res = await fetch("https://example.com", { impersonate: "chrome124" });
 * console.log(res.status, await res.text());
 * ```
 */
export async function fetch(
  input: string | URL | Request,
  init?: ImpersRequestInit,
): Promise<Response> {
  const { url, init: effectiveInit } = await resolveInput(input, init);
  const { options, method, redirect } = convertInit(effectiveInit);

  // Body conversion may be async (Blob/FormData/iterables).
  if (effectiveInit.body !== undefined && effectiveInit.body !== null) {
    await convertBody(effectiveInit.body, options);
  }

  // Use a fresh Session per request so cookies/headers don't leak across
  // stateless fetch() calls. The underlying CurlMulti connection pool is still
  // shared (Session falls back to getSharedMulti()).
  const session = new Session();
  let impersResponse;
  try {
    impersResponse = await session.request(method.toUpperCase(), url, options);
  } catch (error) {
    // Re-wrap network errors as TypeError (Fetch semantics), preserving cause.
    if (error instanceof RequestException) {
      throw new TypeError(error.message, { cause: error });
    }
    throw error;
  } finally {
    await session.close();
  }

  // redirect: "error" -> reject on 3xx
  if (redirect === "error" && impersResponse.statusCode >= 300 && impersResponse.statusCode < 400) {
    throw new TypeError(`redirect response (${impersResponse.statusCode}) not allowed`, {
      cause: impersResponse,
    });
  }

  return new Response(new Uint8Array(impersResponse.content), {
    status: impersResponse.statusCode,
    statusText: impersResponse.reason,
    headers: convertImpersHeadersToGlobal(impersResponse.headers),
  });
}