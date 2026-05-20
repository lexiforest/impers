/**
 * Public API - Standalone request functions
 *
 * These functions provide a simple interface for making HTTP requests
 * without creating a Session. They use a shared session internally
 * for connection pooling.
 */

import { Session } from "./http/session.js";
import { Response } from "./http/response.js";
import type { RequestOptions } from "./types/options.js";

// Shared session for standalone requests
let sharedSession: Session | null = null;

/**
 * Get or create a shared session for standalone requests
 */
function getSharedSession(): Session {
  if (!sharedSession) {
    sharedSession = new Session();
  }
  return sharedSession;
}

/**
 * Close the shared session (call this when your application exits)
 */
export async function closeSharedSession(): Promise<void> {
  if (sharedSession) {
    await sharedSession.close();
    sharedSession = null;
  }
}

/**
 * Make an HTTP request
 *
 * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 *
 * @example
 * ```ts
 * const response = await request("GET", "https://httpbin.org/get");
 * console.log(response.json());
 * ```
 */
export async function request(
  method: string,
  url: string,
  options: RequestOptions = {}
): Promise<Response> {
  return getSharedSession().request(method, url, options);
}

/**
 * Make an HTTP GET request
 *
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 *
 * @example
 * ```ts
 * const response = await get("https://httpbin.org/get", {
 *   params: { key: "value" }
 * });
 * console.log(response.json());
 * ```
 */
export async function get(url: string, options?: RequestOptions): Promise<Response> {
  return request("GET", url, options);
}

/**
 * Make an HTTP POST request
 *
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 *
 * @example
 * ```ts
 * const response = await post("https://httpbin.org/post", {
 *   json: { key: "value" }
 * });
 * console.log(response.json());
 * ```
 */
export async function post(url: string, options?: RequestOptions): Promise<Response> {
  return request("POST", url, options);
}

/**
 * Make an HTTP PUT request
 *
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 */
export async function put(url: string, options?: RequestOptions): Promise<Response> {
  return request("PUT", url, options);
}

/**
 * Make an HTTP DELETE request
 *
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 */
export async function del(url: string, options?: RequestOptions): Promise<Response> {
  return request("DELETE", url, options);
}

/**
 * Make an HTTP HEAD request
 *
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 */
export async function head(url: string, options?: RequestOptions): Promise<Response> {
  return request("HEAD", url, options);
}

/**
 * Make an HTTP OPTIONS request
 *
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 */
export async function options(url: string, options?: RequestOptions): Promise<Response> {
  return request("OPTIONS", url, options);
}

/**
 * Make an HTTP PATCH request
 *
 * @param url - Request URL
 * @param options - Request options
 * @returns Response object
 */
export async function patch(url: string, options?: RequestOptions): Promise<Response> {
  return request("PATCH", url, options);
}

// Re-exports for convenience
export { Session } from "./http/session.js";
export { Response } from "./http/response.js";
export { Request } from "./http/request.js";
export { Headers } from "./http/headers.js";
export { Cookies } from "./http/cookies.js";
export { Curl } from "./core/easy.js";
export { CurlMime } from "./core/mime.js";
export { CurlMulti, getSharedMulti, closeSharedMulti } from "./core/multi.js";
export { CurlOpt, CurlInfo, CurlCode, CurlHttpVersion, CurlWsFlag, CurlImpersonateOpt, CurlSslVersion } from "./ffi/constants.js";

// Fingerprinting utilities
export {
  setJa3Options,
  setAkamaiOptions,
  setExtraFingerprintOptions,
  FingerprintError,
  TLS_CIPHER_NAME_MAP,
  TLS_EC_CURVES_MAP,
  TLS_VERSION_MAP,
  TLS_EXTENSION_NAME_MAP,
} from "./utils/fingerprint.js";

// Platform/libcurl helpers
export {
  resolveLibcurlPath,
  resolveLibrary,
  isUsingImpersonate,
  getPlatformInfo,
  type LibraryInfo,
} from "./utils/platform.js";

// WebSocket exports
export {
  AsyncWebSocket,
  wsConnect,
  WebSocketMessageType,
  type WebSocketMessage,
  type WebSocketCloseEvent,
} from "./websocket/websocket.js";

// Export types
export type {
  RequestOptions,
  SessionOptions,
  WebSocketOptions,
  BasicAuth,
  DigestAuth,
  BearerAuth,
  AuthType,
  ProxyConfig,
  CertConfig,
  MultipartField,
  ExtraFingerprint,
} from "./types/options.js";

export type { HeadersInit } from "./http/headers.js";
export type { CookiesInit, Cookie, CookieOptions } from "./http/cookies.js";

// Export errors
export {
  RequestException,
  CurlError,
  ConnectionError,
  DNSError,
  ProxyError,
  SSLError,
  CertificateVerifyError,
  Timeout,
  ConnectTimeout,
  ReadTimeout,
  HTTPError,
  TooManyRedirects,
  InvalidURL,
  InvalidHeader,
  InvalidProxyURL,
  ImpersonateError,
  SessionClosed,
  WebSocketError,
  WebSocketClosed,
  IncompleteRead,
  InvalidJSONError,
  CookieConflict,
  InterfaceError,
} from "./utils/errors.js";
