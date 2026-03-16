/**
 * HTTP Session with connection pooling and cookie persistence
 */

import { Curl } from "../core/easy.js";
import { CurlMulti, getSharedMulti } from "../core/multi.js";
import { CurlOpt, CurlHttpVersion, CurlAuth } from "../ffi/constants.js";
import { Headers, type HeadersInit } from "./headers.js";
import { Cookies, type CookiesInit, type Cookie } from "./cookies.js";
import { Response } from "./response.js";
import { SList } from "../core/slist.js";
import {
  SessionClosed,
  HTTPError,
  InvalidURL,
  mapCurlError,
} from "../utils/errors.js";
import {
  setJa3Options,
  setAkamaiOptions,
  setExtraFingerprintOptions,
} from "../utils/fingerprint.js";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
} from "node:zlib";
import type {
  RequestOptions,
  SessionOptions,
  BasicAuth,
  DigestAuth,
  BearerAuth,
  AuthType,
  CertConfig,
  MultipartField,
} from "../types/options.js";

/**
 * Session - HTTP client with connection pooling and cookie persistence
 *
 * Provides a high-level interface for making HTTP requests with automatic
 * connection reuse, cookie handling, and browser impersonation support.
 */
export class Session {
  private multi: CurlMulti;
  private ownMulti: boolean;
  private closed: boolean = false;

  // Session defaults
  private _cookies: Cookies;
  private _headers: Headers;
  private _baseUrl: string | null;
  private _defaults: Omit<SessionOptions, "cookies" | "headers" | "baseUrl">;

  constructor(options: SessionOptions = {}) {
    // Create or use shared multi handle
    if (options.maxConnections || options.maxHostConnections) {
      this.multi = new CurlMulti({
        maxTotalConnections: options.maxConnections,
        maxHostConnections: options.maxHostConnections,
        pipelining: options.http2Multiplexing !== false,
      });
      this.ownMulti = true;
    } else {
      this.multi = getSharedMulti();
      this.ownMulti = false;
    }

    // Initialize session-level cookies and headers
    this._cookies = new Cookies(options.cookies);
    this._headers = new Headers(options.headers);
    this._baseUrl = options.baseUrl || null;

    // Store remaining defaults
    const { cookies, headers, baseUrl, maxConnections, maxHostConnections, http2Multiplexing, ...defaults } = options;
    this._defaults = defaults;
  }

  /**
   * Get session cookies
   */
  get cookies(): Cookies {
    return this._cookies;
  }

  /**
   * Get session headers
   */
  get headers(): Headers {
    return this._headers;
  }

  /**
   * Make an HTTP request
   */
  async request(method: string, url: string, options: RequestOptions = {}): Promise<Response> {
    if (this.closed) {
      throw new SessionClosed();
    }

    // Resolve URL with base URL and params
    const resolvedUrl = this.resolveUrl(url, options.params);

    // Merge options with session defaults
    const mergedOptions = this.mergeOptions(options);

    // Create curl handle
    const curl = new Curl();
    const slists: SList[] = [];

    try {
      // Set URL
      curl.setOpt(CurlOpt.URL, resolvedUrl);

      // Set method
      this.setMethod(curl, method.toUpperCase(), mergedOptions);

      // Set headers
      const headerList = this.buildHeaders(method, mergedOptions, resolvedUrl);
      if (headerList.length > 0) {
        const slist = new SList();
        headerList.forEach((h) => slist.append(h));
        slists.push(slist);
        curl.setOpt(CurlOpt.HTTPHEADER, slist.pointer);
      }

      // Set cookies
      const cookieHeader = this.buildCookieHeader(resolvedUrl, mergedOptions);
      if (cookieHeader) {
        curl.setOpt(CurlOpt.COOKIE, cookieHeader);
      }

      // Set body
      this.setBody(curl, method, mergedOptions);

      // Set authentication
      this.setAuth(curl, mergedOptions);

      // Set proxy
      this.setProxy(curl, mergedOptions);

      // Set SSL/TLS options
      this.setSslOptions(curl, mergedOptions);

      // Set timeouts
      this.setTimeouts(curl, mergedOptions);

      // Set redirects
      this.setRedirects(curl, mergedOptions);

      // Set HTTP version
      this.setHttpVersion(curl, mergedOptions);

      // Set network interface
      this.setInterface(curl, mergedOptions);

      // Set DNS options
      this.setDnsOptions(curl, mergedOptions);

      // Set impersonation
      this.setImpersonation(curl, mergedOptions);

      // Set raw curl options
      if (mergedOptions.curlOptions) {
        for (const [opt, value] of Object.entries(mergedOptions.curlOptions)) {
          curl.setOpt(Number(opt), value);
        }
      }

      // Collect response data
      const bodyChunks: Buffer[] = [];
      const headerChunks: Buffer[] = [];

      curl.setWriteFunction((chunk) => {
        if (mergedOptions.contentCallback) {
          mergedOptions.contentCallback(chunk);
        }
        if (!mergedOptions.stream) {
          bodyChunks.push(Buffer.from(chunk));
        }
      });

      curl.setHeaderFunction((chunk) => {
        headerChunks.push(Buffer.from(chunk));
      });

      // Perform request
      const startTime = Date.now();
      await this.multi.perform(curl);
      const elapsed = (Date.now() - startTime) / 1000;

      const rawHeaders: Buffer = Buffer.concat(headerChunks);
      let content: Buffer = Buffer.concat(bodyChunks);

      // Split raw headers into per-response segments for redirect history
      const segments = Headers.splitRawByResponse(rawHeaders);

      // Build redirect history from intermediate responses (all except last)
      const history: Response[] = [];
      let currentUrl = resolvedUrl;

      if (segments.length > 1) {
        for (let i = 0; i < segments.length - 1; i++) {
          const seg = segments[i];

          const intermediateResponse = new Response({
            headers: seg.headers,
            requestUrl: currentUrl,
            statusCode: seg.statusCode,
            statusText: seg.statusText,
            url: currentUrl,
          });

          // Update session cookies from intermediate response
          for (const cookie of intermediateResponse.cookies) {
            this._cookies.set(cookie.name, cookie.value, cookie);
          }

          history.push(intermediateResponse);

          // Resolve next URL from Location header
          const location = seg.headers.get("location");
          if (location) {
            try {
              currentUrl = new URL(location, currentUrl).href;
            } catch {
              currentUrl = location;
            }
          }
        }
      }

      // Use only the last segment's headers for content decoding
      const lastSegment = segments.length > 0 ? segments[segments.length - 1] : null;

      if (!mergedOptions.stream && mergedOptions.decodeContent !== false) {
        const encoding = lastSegment
          ? lastSegment.headers.get("content-encoding")
          : Headers.fromRaw(rawHeaders).get("content-encoding");
        const decoded = this.decodeContent(content, encoding);
        if (decoded) {
          content = decoded;
        }
      }

      const response = new Response({
        content,
        headers: lastSegment?.headers,
        curl,
        requestUrl: resolvedUrl,
        elapsed,
        history,
        // Pass the resolved final URL from redirect chain, in case
        // CURLINFO_EFFECTIVE_URL doesn't reflect the redirect target
        url: history.length > 0 ? currentUrl : undefined,
      });

      // Update session cookies from final response
      for (const cookie of response.cookies) {
        this._cookies.set(cookie.name, cookie.value, cookie);
      }

      return response;
    } finally {
      // Cleanup
      slists.forEach((s) => s.free());
      curl.cleanup();
    }
  }

  /**
   * HTTP GET request
   */
  async get(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("GET", url, options);
  }

  /**
   * HTTP POST request
   */
  async post(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("POST", url, options);
  }

  /**
   * HTTP PUT request
   */
  async put(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("PUT", url, options);
  }

  /**
   * HTTP DELETE request
   */
  async delete(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("DELETE", url, options);
  }

  /**
   * HTTP HEAD request
   */
  async head(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("HEAD", url, options);
  }

  /**
   * HTTP OPTIONS request
   */
  async options(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("OPTIONS", url, options);
  }

  /**
   * HTTP PATCH request
   */
  async patch(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("PATCH", url, options);
  }

  /**
   * Close the session and release resources
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.ownMulti) {
      await this.multi.close();
    }
  }

  /**
   * Resolve URL with base URL
   */
  private resolveUrl(url: string, params?: Record<string, string | number | boolean | Array<string | number | boolean>> | URLSearchParams): string {
    let resolvedUrl = url;

    // Apply base URL if needed
    if (this._baseUrl && !url.match(/^https?:\/\//)) {
      // Relative URL - resolve against base
      const base = this._baseUrl.endsWith("/") ? this._baseUrl.slice(0, -1) : this._baseUrl;
      const path = url.startsWith("/") ? url : "/" + url;
      resolvedUrl = base + path;
    }

    // Add query parameters
    if (params) {
      const urlObj = new URL(resolvedUrl);
      if (params instanceof URLSearchParams) {
        params.forEach((value, key) => urlObj.searchParams.append(key, value));
      } else {
        for (const [key, value] of Object.entries(params)) {
          if (Array.isArray(value)) {
            for (const v of value) {
              urlObj.searchParams.append(key, String(v));
            }
          } else {
            urlObj.searchParams.append(key, String(value));
          }
        }
      }
      resolvedUrl = urlObj.toString();
    }

    return resolvedUrl;
  }

  /**
   * Merge request options with session defaults
   */
  private mergeOptions(options: RequestOptions): RequestOptions {
    return {
      ...this._defaults,
      ...options,
      headers: options.headers, // Will be merged separately with session headers
    };
  }

  private decodeContent(content: Buffer, encodingHeader: string | null): Buffer | null {
    if (!encodingHeader || content.length === 0) {
      return null;
    }

    const encodings = encodingHeader
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map((value) => value.split(";")[0]?.trim() || "")
      .filter(Boolean);

    if (encodings.length === 0) {
      return null;
    }

    const supported = new Set(["gzip", "deflate", "br", "identity"]);
    for (const encoding of encodings) {
      if (!supported.has(encoding)) {
        return null;
      }
    }

    let decoded = content;
    for (let i = encodings.length - 1; i >= 0; i -= 1) {
      const encoding = encodings[i];
      if (encoding === "identity") {
        continue;
      }
      if (encoding === "gzip") {
        decoded = gunzipSync(decoded);
        continue;
      }
      if (encoding === "deflate") {
        try {
          decoded = inflateSync(decoded);
        } catch {
          decoded = inflateRawSync(decoded);
        }
        continue;
      }
      if (encoding === "br") {
        decoded = brotliDecompressSync(decoded);
      }
    }

    return decoded;
  }

  /**
   * Set HTTP method
   */
  private setMethod(curl: Curl, method: string, options: RequestOptions): void {
    switch (method) {
      case "GET":
        curl.setOpt(CurlOpt.HTTPGET, 1);
        break;
      case "POST":
        curl.setOpt(CurlOpt.POST, 1);
        break;
      case "HEAD":
        curl.setOpt(CurlOpt.NOBODY, 1);
        break;
      case "PUT":
        curl.setOpt(CurlOpt.CUSTOMREQUEST, "PUT");
        break;
      case "DELETE":
        curl.setOpt(CurlOpt.CUSTOMREQUEST, "DELETE");
        break;
      case "PATCH":
        curl.setOpt(CurlOpt.CUSTOMREQUEST, "PATCH");
        break;
      case "OPTIONS":
        curl.setOpt(CurlOpt.CUSTOMREQUEST, "OPTIONS");
        break;
      default:
        curl.setOpt(CurlOpt.CUSTOMREQUEST, method);
    }
  }

  /**
   * Build headers list for curl
   */
  private buildHeaders(method: string, options: RequestOptions, url: string): string[] {
    const headers = new Headers();

    // Add session headers first
    for (const [name, value] of this._headers) {
      headers.append(name, value);
    }

    // Add request headers (override session headers)
    if (options.headers) {
      const reqHeaders = new Headers(options.headers);
      for (const [name, value] of reqHeaders) {
        headers.set(name, value);
      }
    }

    // Add User-Agent if not set
    if (!headers.has("user-agent") && options.userAgent) {
      headers.set("User-Agent", options.userAgent);
    }

    // Add Accept-Encoding if not set
    if (!headers.has("accept-encoding")) {
      const encoding = options.acceptEncoding ?? "gzip, deflate, br";
      if (encoding) {
        headers.set("Accept-Encoding", encoding);
      }
    }

    // Add Referer if specified
    if (options.referer) {
      headers.set("Referer", options.referer);
    }

    // Add Content-Type for body
    if (options.json !== undefined && !headers.has("content-type")) {
      headers.set("Content-Type", "application/json");
    } else if (options.data !== undefined && !headers.has("content-type")) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }

    return headers.toCurlHeaders();
  }

  /**
   * Build cookie header for request
   */
  private buildCookieHeader(url: string, options: RequestOptions): string | null {
    const cookies = new Cookies();

    // Add session cookies matching the URL
    const sessionCookies = this._cookies.getForUrl(url);
    for (const cookie of sessionCookies) {
      cookies.set(cookie.name, cookie.value, cookie);
    }

    // Add/override with request cookies
    if (options.cookies) {
      cookies.update(options.cookies);
    }

    const header = cookies.toCookieHeader();
    return header || null;
  }

  /**
   * Set request body
   */
  private setBody(curl: Curl, method: string, options: RequestOptions): void {
    let body: Buffer | null = null;

    if (options.json !== undefined) {
      body = Buffer.from(JSON.stringify(options.json), "utf-8");
    } else if (options.data !== undefined) {
      if (typeof options.data === "string") {
        body = Buffer.from(options.data, "utf-8");
      } else if (options.data instanceof URLSearchParams) {
        body = Buffer.from(options.data.toString(), "utf-8");
      } else {
        // Convert object to URL-encoded form
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options.data)) {
          params.append(key, String(value));
        }
        body = Buffer.from(params.toString(), "utf-8");
      }
    } else if (options.content !== undefined) {
      body = Buffer.isBuffer(options.content)
        ? options.content
        : Buffer.from(options.content, "utf-8");
    }

    if (body) {
      curl.setOpt(CurlOpt.POSTFIELDS, body);
      curl.setOpt(CurlOpt.POSTFIELDSIZE, body.length);
    }

    // TODO: Handle multipart/files with CurlMime
  }

  /**
   * Set authentication
   */
  private setAuth(curl: Curl, options: RequestOptions): void {
    if (!options.auth) return;

    if (typeof options.auth === "string") {
      // "username:password" format
      curl.setOpt(CurlOpt.USERPWD, options.auth);
    } else if ("token" in options.auth) {
      // Bearer token
      const bearer = options.auth as BearerAuth;
      curl.setOpt(CurlOpt.XOAUTH2_BEARER, bearer.token);
      curl.setOpt(CurlOpt.HTTPAUTH, CurlAuth.CURLAUTH_BEARER);
    } else if ("type" in options.auth && options.auth.type === "digest") {
      // Digest auth
      const digest = options.auth as DigestAuth;
      curl.setOpt(CurlOpt.USERPWD, `${digest.username}:${digest.password}`);
      curl.setOpt(CurlOpt.HTTPAUTH, CurlAuth.CURLAUTH_DIGEST);
    } else {
      // Basic auth (default)
      const basic = options.auth as BasicAuth;
      curl.setOpt(CurlOpt.USERPWD, `${basic.username}:${basic.password}`);
      curl.setOpt(CurlOpt.HTTPAUTH, CurlAuth.CURLAUTH_BASIC);
    }
  }

  /**
   * Set proxy configuration
   */
  private setProxy(curl: Curl, options: RequestOptions): void {
    const proxy = options.proxy || options.proxies?.all || options.proxies?.https || options.proxies?.http;

    if (proxy) {
      curl.setOpt(CurlOpt.PROXY, proxy);
    }

    if (options.proxyAuth) {
      curl.setOpt(
        CurlOpt.PROXYUSERPWD,
        `${options.proxyAuth.username}:${options.proxyAuth.password}`
      );
    }
  }

  /**
   * Set SSL/TLS options
   */
  private setSslOptions(curl: Curl, options: RequestOptions): void {
    // SSL verification
    if (options.verify === false) {
      curl.setOpt(CurlOpt.SSL_VERIFYPEER, 0);
      curl.setOpt(CurlOpt.SSL_VERIFYHOST, 0);
    } else {
      curl.setOpt(CurlOpt.SSL_VERIFYPEER, 1);
      curl.setOpt(CurlOpt.SSL_VERIFYHOST, 2);
    }

    // CA certificate
    if (options.caCert) {
      curl.setOpt(CurlOpt.CAINFO, options.caCert);
    }

    // Client certificate
    if (options.cert) {
      if (typeof options.cert === "string") {
        curl.setOpt(CurlOpt.SSLCERT, options.cert);
      } else {
        const certConfig = options.cert as CertConfig;
        curl.setOpt(CurlOpt.SSLCERT, certConfig.cert);
        if (certConfig.key) {
          curl.setOpt(CurlOpt.SSLKEY, certConfig.key);
        }
        if (certConfig.password) {
          curl.setOpt(CurlOpt.KEYPASSWD, certConfig.password);
        }
      }
    }
  }

  /**
   * Set timeouts
   */
  private setTimeouts(curl: Curl, options: RequestOptions): void {
    if (options.timeout !== undefined) {
      // Convert seconds to milliseconds
      curl.setOpt(CurlOpt.TIMEOUT_MS, Math.floor(options.timeout * 1000));
    }

    if (options.connectTimeout !== undefined) {
      curl.setOpt(CurlOpt.CONNECTTIMEOUT_MS, Math.floor(options.connectTimeout * 1000));
    }
  }

  /**
   * Set redirect behavior
   */
  private setRedirects(curl: Curl, options: RequestOptions): void {
    const allowRedirects = options.allowRedirects !== false;
    curl.setOpt(CurlOpt.FOLLOWLOCATION, allowRedirects ? 1 : 0);

    if (allowRedirects) {
      const maxRedirects = options.maxRedirects ?? 30;
      curl.setOpt(CurlOpt.MAXREDIRS, maxRedirects);
    }
  }

  /**
   * Set HTTP version
   */
  private setHttpVersion(curl: Curl, options: RequestOptions): void {
    if (!options.httpVersion) return;

    switch (options.httpVersion) {
      case "1.0":
        curl.setOpt(CurlOpt.HTTP_VERSION, CurlHttpVersion.CURL_HTTP_VERSION_1_0);
        break;
      case "1.1":
        curl.setOpt(CurlOpt.HTTP_VERSION, CurlHttpVersion.CURL_HTTP_VERSION_1_1);
        break;
      case "2":
        curl.setOpt(CurlOpt.HTTP_VERSION, CurlHttpVersion.CURL_HTTP_VERSION_2_0);
        break;
      case "3":
        curl.setOpt(CurlOpt.HTTP_VERSION, CurlHttpVersion.CURL_HTTP_VERSION_3);
        break;
    }
  }

  /**
   * Set network interface options
   */
  private setInterface(curl: Curl, options: RequestOptions): void {
    if (options.interface) {
      curl.setOpt(CurlOpt.INTERFACE, options.interface);
    }

    if (options.localAddress) {
      curl.setOpt(CurlOpt.INTERFACE, options.localAddress);
    }

    if (options.localPort) {
      curl.setOpt(CurlOpt.LOCALPORT, options.localPort);
    }
  }

  /**
   * Set DNS options
   */
  private setDnsOptions(curl: Curl, options: RequestOptions): void {
    if (options.dnsServers && options.dnsServers.length > 0) {
      curl.setOpt(CurlOpt.DNS_SERVERS, options.dnsServers.join(","));
    }

    if (options.dohUrl) {
      curl.setOpt(CurlOpt.DOH_URL, options.dohUrl);
    }
  }

  /**
   * Set browser impersonation and fingerprinting options
   */
  private setImpersonation(curl: Curl, options: RequestOptions): void {
    let impersonateApplied = false;

    // First, try to apply browser impersonation if specified
    if (options.impersonate) {
      try {
        curl.impersonate(options.impersonate, options.defaultHeaders !== false);
        impersonateApplied = true;
      } catch {
        // Impersonation not available (using standard libcurl)
        // Fall through to manual fingerprinting if ja3/akamai provided
      }
    }

    // Apply extra fingerprint options (can complement impersonate or work standalone)
    if (options.extraFp) {
      setExtraFingerprintOptions(curl, options.extraFp);
    }

    // Apply JA3 TLS fingerprint
    // Note: If impersonate was already applied, JA3 will override TLS settings
    if (options.ja3) {
      setJa3Options(curl, options.ja3);
    }

    // Apply Akamai HTTP/2 fingerprint
    // Note: If impersonate was already applied, Akamai will override HTTP/2 settings
    if (options.akamai) {
      setAkamaiOptions(curl, options.akamai);
    }
  }
}
