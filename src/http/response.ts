/**
 * HTTP Response representation
 */

import { Headers } from "./headers.js";
import { Cookies, type Cookie } from "./cookies.js";
import { Curl } from "../core/easy.js";
import { CurlInfo, CurlHttpVersion } from "../ffi/constants.js";
import { HTTPError } from "../utils/errors.js";

export interface ResponseInit {
  content?: Buffer;
  rawHeaders?: Buffer | string;
  headers?: Headers;
  curl?: Curl;
  requestUrl?: string;
  elapsed?: number;
  history?: Response[];
  statusCode?: number;
  statusText?: string;
  url?: string;
}

/**
 * Response - HTTP response with headers, cookies, and body
 */
export class Response {
  // Request info
  readonly requestUrl: string;

  // Response metadata from curl
  readonly url: string;
  readonly statusCode: number;
  readonly headers: Headers;
  readonly cookies: Cookies;
  readonly elapsed: number;
  readonly primaryIp: string | null;
  readonly primaryPort: number;
  readonly localIp: string | null;
  readonly localPort: number;
  readonly redirectCount: number;
  /**
   * URL of the next redirect that was NOT followed, or null if all redirects
   * were followed. When allowRedirects is true (default), this will be null
   * after a successful redirect chain. Use `response.url` for the final URL,
   * or `response.history` for intermediate Response objects at each redirect step.
   */
  readonly redirectUrl: string | null;
  readonly httpVersion: number;
  readonly contentType: string | null;

  // Redirect history
  readonly history: Response[];

  // Content
  private _content: Buffer | null = null;
  private _stream: AsyncIterable<Buffer> | null = null;
  private _encoding: BufferEncoding = "utf-8";
  private readonly _statusText: string | null = null;

  constructor(init: ResponseInit) {
    this.requestUrl = init.requestUrl || "";
    this.history = init.history || [];
    this.elapsed = init.elapsed || 0;

    // Set content if provided
    if (init.content) {
      this._content = init.content;
    }

    // Use pre-parsed headers if provided, otherwise parse from raw
    if (init.headers) {
      this.headers = init.headers;
    } else if (init.rawHeaders) {
      this.headers = Headers.fromRaw(init.rawHeaders);
    } else {
      this.headers = new Headers();
    }

    // Get metadata from curl handle
    if (init.curl) {
      this.url = init.url || init.curl.getEffectiveUrl() || this.requestUrl;
      this.statusCode = init.curl.getResponseCode();
      this.primaryIp = init.curl.getPrimaryIp();
      this.primaryPort = init.curl.getPrimaryPort();
      this.localIp = init.curl.getLocalIp();
      this.localPort = init.curl.getLocalPort();
      this.redirectCount = init.curl.getRedirectCount();
      this.redirectUrl = init.curl.getRedirectUrl();
      this.httpVersion = init.curl.getHttpVersion();
      this.contentType = init.curl.getContentType() || this.headers.get("content-type");
    } else {
      this.url = init.url || this.requestUrl;
      this.statusCode = init.statusCode || 0;
      this.primaryIp = null;
      this.primaryPort = 0;
      this.localIp = null;
      this.localPort = 0;
      this.redirectCount = 0;
      this.redirectUrl = null;
      this.httpVersion = CurlHttpVersion.CURL_HTTP_VERSION_1_1;
      this.contentType = this.headers.get("content-type");
    }

    // Store wire status text (falls back to lookup table in getter)
    this._statusText = init.statusText || null;

    // Detect encoding from content-type
    this._encoding = this.detectEncoding();

    // Extract cookies from headers using effective URL (after redirects)
    this.cookies = new Cookies();

    const cookieUrl = this.url;
    const setCookies = this.headers.getAll("set-cookie");

    for (const setCookie of setCookies) {
      try {
        const cookie = Cookies.parseSetCookie(
          setCookie,
          cookieUrl ? new URL(cookieUrl) : undefined,
        );

        this.cookies.set(cookie.name, cookie.value, cookie);
      } catch {
        // Ignore invalid cookies
      }
    }
  }

  /**
   * Detect character encoding from Content-Type header
   */
  private detectEncoding(): BufferEncoding {
    const contentType = this.contentType || this.headers.get("content-type");
    if (contentType) {
      const match = contentType.match(/charset=([^\s;]+)/i);
      if (match) {
        const charset = match[1].toLowerCase().replace(/['"]/g, "");
        // Map common charset names to Node.js BufferEncoding
        const charsetMap: Record<string, BufferEncoding> = {
          "utf-8": "utf-8",
          "utf8": "utf-8",
          "iso-8859-1": "latin1",
          "latin1": "latin1",
          "ascii": "ascii",
          "us-ascii": "ascii",
          "utf-16le": "utf16le",
          "ucs-2": "utf16le",
        };
        return charsetMap[charset] || "utf-8";
      }
    }
    return "utf-8";
  }

  /**
   * HTTP status code (alias for statusCode)
   */
  get status(): number {
    return this.statusCode;
  }

  /**
   * HTTP status reason phrase (alias for reason)
   */
  get statusText(): string {
    return this.reason;
  }

  /**
   * Check if response was successful (2xx status)
   */
  get ok(): boolean {
    return this.statusCode >= 200 && this.statusCode < 300;
  }

  /**
   * Get status reason phrase
   */
  get reason(): string {
    return this._statusText || HTTP_STATUS_CODES[this.statusCode] || "Unknown";
  }

  /**
   * Get response encoding
   */
  get encoding(): string {
    return this._encoding;
  }

  /**
   * Set response encoding
   */
  set encoding(value: string) {
    this._encoding = value as BufferEncoding;
  }

  /**
   * Get HTTP version as string
   */
  get httpVersionString(): string {
    switch (this.httpVersion) {
      case CurlHttpVersion.CURL_HTTP_VERSION_1_0:
        return "1.0";
      case CurlHttpVersion.CURL_HTTP_VERSION_1_1:
        return "1.1";
      case CurlHttpVersion.CURL_HTTP_VERSION_2_0:
      case CurlHttpVersion.CURL_HTTP_VERSION_2TLS:
      case CurlHttpVersion.CURL_HTTP_VERSION_2_PRIOR_KNOWLEDGE:
        return "2";
      case CurlHttpVersion.CURL_HTTP_VERSION_3:
      case CurlHttpVersion.CURL_HTTP_VERSION_3ONLY:
        return "3";
      default:
        return "1.1";
    }
  }

  /**
   * Get response body as Buffer (sync)
   * Throws if content is not available (streaming response)
   */
  get content(): Buffer {
    if (this._content === null) {
      throw new Error(
        "Response content not available. " +
        "Use await response.aContent() for streaming responses."
      );
    }
    return this._content;
  }

  /**
   * Get response body as string (sync)
   */
  get text(): string {
    return this.content.toString(this._encoding);
  }

  /**
   * Parse response body as JSON (sync)
   */
  json<T = unknown>(): T {
    return JSON.parse(this.text);
  }

  /**
   * Raise an exception if status code indicates an error
   */
  raiseForStatus(): void {
    if (this.statusCode >= 400) {
      throw new HTTPError(this.statusCode, this.reason, this);
    }
  }

  /**
   * Async content getter
   */
  async aContent(): Promise<Buffer> {
    if (this._content !== null) {
      return this._content;
    }

    if (this._stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of this._stream) {
        chunks.push(chunk);
      }
      this._content = Buffer.concat(chunks);
      return this._content;
    }

    return Buffer.alloc(0);
  }

  /**
   * Async text getter
   */
  async aText(): Promise<string> {
    const content = await this.aContent();
    return content.toString(this._encoding);
  }

  /**
   * Async JSON parser
   */
  async aJson<T = unknown>(): Promise<T> {
    const text = await this.aText();
    return JSON.parse(text);
  }

  /**
   * Iterate over response content in chunks
   */
  async *iterContent(chunkSize?: number): AsyncIterableIterator<Buffer> {
    if (this._stream) {
      yield* this._stream;
    } else if (this._content) {
      if (chunkSize && chunkSize > 0) {
        for (let i = 0; i < this._content.length; i += chunkSize) {
          yield this._content.subarray(i, i + chunkSize);
        }
      } else {
        yield this._content;
      }
    }
  }

  /**
   * Iterate over response content line by line
   */
  async *iterLines(
    delimiter: string = "\n",
    keepEnds: boolean = false
  ): AsyncIterableIterator<string> {
    let buffer = "";

    for await (const chunk of this.iterContent()) {
      buffer += chunk.toString(this._encoding);
      const lines = buffer.split(delimiter);
      buffer = lines.pop() || "";

      for (const line of lines) {
        yield keepEnds ? line + delimiter : line;
      }
    }

    if (buffer) {
      yield buffer;
    }
  }

  /**
   * Set the response stream (for streaming responses)
   */
  setStream(stream: AsyncIterable<Buffer>): void {
    this._stream = stream;
  }

  /**
   * Set the response content directly
   */
  setContent(content: Buffer): void {
    this._content = content;
  }

  /**
   * Close the response (cleanup resources)
   */
  async close(): Promise<void> {
    // Nothing to do for buffered responses
    // Streaming responses would need cleanup here
  }

  /**
   * Alias for close
   */
  async aClose(): Promise<void> {
    return this.close();
  }
}

/**
 * HTTP status code reason phrases
 */
const HTTP_STATUS_CODES: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};
