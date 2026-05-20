/**
 * Request and Session options types
 */

import type { HeadersInit } from "../http/headers.js";
import type { CookiesInit } from "../http/cookies.js";

/**
 * Authentication types
 */
export interface BasicAuth {
  username: string;
  password: string;
}

export interface DigestAuth {
  username: string;
  password: string;
  type: "digest";
}

export interface BearerAuth {
  token: string;
}

export type AuthType = BasicAuth | DigestAuth | BearerAuth | string;

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  http?: string;
  https?: string;
  all?: string;
}

/**
 * Certificate configuration
 */
export interface CertConfig {
  cert: string;
  key?: string;
  password?: string;
}

/**
 * Multipart form field
 */
export interface MultipartField {
  name: string;
  value?: string | Buffer;
  filename?: string;
  filepath?: string;
  contentType?: string;
}

/**
 * Extra fingerprint options for manual TLS/HTTP2 configuration
 */
export interface ExtraFingerprint {
  /** TLS extension order */
  tlsExtensionOrder?: number[];
  /** TLS signature algorithms */
  tlsSigAlgs?: string[];
  /** TLS supported groups */
  tlsSupportedGroups?: string[];
  /** HTTP/2 settings */
  http2Settings?: Record<string, number>;
  /** HTTP/2 window update */
  http2WindowUpdate?: number;
  /** HTTP/2 pseudo header order */
  http2PseudoHeaderOrder?: string[];
  /** HTTP/2 connection flow */
  http2ConnectionFlow?: number;
}

/**
 * Request options - passed to individual requests
 */
export interface RequestOptions {
  // URL parameters
  /** Query string parameters */
  params?: Record<string, string | number | boolean | (string | number | boolean)[]> | URLSearchParams;

  // Request body
  /** Form data (application/x-www-form-urlencoded) */
  data?: Record<string, string | number | boolean> | URLSearchParams | string;
  /** JSON body (automatically sets Content-Type) */
  json?: unknown;
  /** Multipart form data (automatically sets Content-Type) */
  multipart?: MultipartField[];
  /** Raw body content */
  content?: string | Buffer;
  /** Files for multipart upload */
  files?: Record<string, string | Buffer | { filename: string; content: Buffer; contentType?: string }>;
  /** Request body callback for streamed uploads */
  readCallback?: (size: number) => Buffer | string | null | undefined;
  /** Total byte size for readCallback request bodies */
  readCallbackSize?: number | bigint;

  // Headers and cookies
  /** Request headers */
  headers?: HeadersInit;
  /** Request cookies */
  cookies?: CookiesInit;
  /** Referer header */
  referer?: string;

  // Authentication
  /** HTTP authentication */
  auth?: AuthType;

  // Timeouts
  /** Total request timeout in seconds */
  timeout?: number;
  /** Connection timeout in seconds */
  connectTimeout?: number;
  /** Read timeout in seconds (same as timeout for simplicity) */
  readTimeout?: number;

  // Redirects
  /** Follow redirects (default: true) */
  allowRedirects?: boolean;
  /** Maximum number of redirects (default: 30) */
  maxRedirects?: number;

  // Proxy
  /** Proxy URL (applies to all protocols) */
  proxy?: string;
  /** Protocol-specific proxies */
  proxies?: ProxyConfig;
  /** Proxy authentication */
  proxyAuth?: BasicAuth;

  // SSL/TLS
  /** Verify SSL certificates (default: true) */
  verify?: boolean;
  /** CA certificate bundle path */
  caCert?: string;
  /** Client certificate */
  cert?: string | CertConfig;

  // Browser impersonation
  /** Browser to impersonate (e.g., "chrome124", "firefox120") */
  impersonate?: string;
  /** JA3 fingerprint string */
  ja3?: string;
  /** Akamai HTTP/2 fingerprint */
  akamai?: string;
  /** Extra fingerprint options */
  extraFp?: ExtraFingerprint;
  /** Default headers when impersonating (default: true) */
  defaultHeaders?: boolean;

  // Streaming
  /** Enable streaming response */
  stream?: boolean;
  /** Content callback for streaming */
  contentCallback?: (chunk: Buffer) => void;
  /** Header callback for raw response header chunks */
  headerCallback?: (chunk: Buffer) => void;

  // HTTP version
  /** Force specific HTTP version ("1.0", "1.1", "2", "3") */
  httpVersion?: "1.0" | "1.1" | "2" | "3";

  // Network interface
  /** Network interface to use */
  interface?: string;
  /** Local address to bind to */
  localAddress?: string;
  /** Local port to bind to */
  localPort?: number;

  // DNS
  /** DNS servers to use */
  dnsServers?: string[];
  /** DNS-over-HTTPS URL */
  dohUrl?: string;

  // Misc
  /** User-Agent header */
  userAgent?: string;
  /** Accept-Encoding header (default: "gzip, deflate, br") */
  acceptEncoding?: string;
  /** Decode response content automatically (default: true) */
  decodeContent?: boolean;

  // Raw curl options (escape hatch)
  /** Raw curl options to set */
  curlOptions?: Record<number, unknown>;
}

/**
 * Session options - configure default behavior for all requests
 */
export interface SessionOptions extends Omit<RequestOptions, "params" | "data" | "json" | "multipart" | "content" | "files"> {
  // Session-specific
  /** Base URL for all requests */
  baseUrl?: string;
  /** Maximum concurrent connections */
  maxConnections?: number;
  /** Maximum connections per host */
  maxHostConnections?: number;
  /** Enable HTTP/2 multiplexing */
  http2Multiplexing?: boolean;

  // Keep default headers/cookies
  /** Default headers for all requests */
  headers?: HeadersInit;
  /** Default cookies for all requests */
  cookies?: CookiesInit;
}

/**
 * WebSocket options
 */
export interface WebSocketOptions {
  /** Request headers */
  headers?: HeadersInit;
  /** Request cookies */
  cookies?: CookiesInit;
  /** Authentication */
  auth?: AuthType;
  /** Proxy URL */
  proxy?: string;
  /** Verify SSL certificates (default: true) */
  verify?: boolean;
  /** Browser to impersonate */
  impersonate?: string;
  /** Connection timeout in seconds */
  timeout?: number;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
  /** Reconnect delay in milliseconds */
  reconnectDelay?: number;
  /** Maximum message size in bytes (default: 64MB) */
  maxMessageSize?: number;
}
