import {
  curl_easy_init,
  curl_easy_cleanup,
  curl_easy_perform,
  curl_easy_duphandle,
  curl_easy_reset,
  curl_easy_setopt_long,
  curl_easy_setopt_string,
  curl_easy_setopt_ptr,
  curl_easy_setopt_int64,
  curl_easy_getinfo_long,
  curl_easy_getinfo_double,
  curl_easy_getinfo_string,
  curl_easy_getinfo_slist,
  curl_easy_getinfo_off_t,
  curl_easy_impersonate,
  curl_version,
  curl_version_info,
  hasImpersonateSupport,
  type CurlHandle,
} from "../ffi/libcurl.js";
import { CurlOpt, CurlInfo, CurlCode, CurlVersion } from "../ffi/constants.js";
import { raiseIfError } from "../utils/errors.js";
import { wrapWriteCallback, type WriteCallback } from "../utils/callbacks.js";
import { SList } from "./slist.js";
import type { ExtraFingerprint } from "../types/options.js";

// Info type masks for determining which getinfo variant to use
const CURLINFO_TYPEMASK = 0xf00000;
const CURLINFO_STRING = 0x100000;
const CURLINFO_LONG = 0x200000;
const CURLINFO_DOUBLE = 0x300000;
const CURLINFO_SLIST = 0x400000;
const CURLINFO_OFF_T = 0x600000;

export interface CurlOptions {
  /** Use an existing handle instead of creating a new one */
  fromHandle?: CurlHandle;
}

/**
 * Curl - Low-level wrapper around libcurl easy interface
 *
 * Provides direct access to curl_easy_* functions with proper
 * memory management for callbacks and string lists.
 */
export class Curl {
  private handle: CurlHandle | null;
  private _callbacks: unknown[];
  private _slists: SList[];
  private _buffers: Buffer[];

  constructor(options: CurlOptions = {}) {
    if (options.fromHandle) {
      this.handle = options.fromHandle;
    } else {
      this.handle = curl_easy_init();
      if (!this.handle) {
        throw new Error("curl_easy_init failed");
      }
    }

    this._callbacks = [];
    this._slists = [];
    this._buffers = [];
  }

  /**
   * Get the underlying curl handle (for use with CurlMulti)
   */
  getHandle(): CurlHandle | null {
    return this.handle;
  }

  /**
   * Set a curl option
   * Automatically selects the correct setopt variant based on value type
   */
  setOpt(option: number, value: unknown): void {
    if (value === undefined || value === null) {
      return;
    }

    if (!this.handle) {
      throw new Error("Curl handle is null");
    }

    let code: number;

    if (typeof value === "string") {
      code = curl_easy_setopt_string(this.handle, option, value);
    } else if (typeof value === "number") {
      code = curl_easy_setopt_long(this.handle, option, value);
    } else if (typeof value === "boolean") {
      code = curl_easy_setopt_long(this.handle, option, value ? 1 : 0);
    } else if (typeof value === "bigint") {
      code = curl_easy_setopt_int64(this.handle, option, value);
    } else if (Buffer.isBuffer(value)) {
      // Keep reference to prevent GC
      this._buffers.push(value);
      code = curl_easy_setopt_ptr(this.handle, option, value);
    } else {
      code = curl_easy_setopt_ptr(this.handle, option, value);
    }

    raiseIfError(code);
  }

  /**
   * Get info from a completed transfer
   * Automatically selects the correct getinfo variant based on info type
   */
  getInfo(info: number): string | number | bigint | string[] | null {
    if (!this.handle) {
      throw new Error("Curl handle is null");
    }

    const infoType = info & CURLINFO_TYPEMASK;

    switch (infoType) {
      case CURLINFO_STRING: {
        const { code, value } = curl_easy_getinfo_string(this.handle, info);
        raiseIfError(code);
        return value;
      }
      case CURLINFO_LONG: {
        const { code, value } = curl_easy_getinfo_long(this.handle, info);
        raiseIfError(code);
        return value;
      }
      case CURLINFO_DOUBLE: {
        const { code, value } = curl_easy_getinfo_double(this.handle, info);
        raiseIfError(code);
        return value;
      }
      case CURLINFO_SLIST: {
        const { code, value } = curl_easy_getinfo_slist(this.handle, info);
        raiseIfError(code);
        // TODO: Convert slist to string array
        return value as unknown as string[];
      }
      case CURLINFO_OFF_T: {
        const { code, value } = curl_easy_getinfo_off_t(this.handle, info);
        raiseIfError(code);
        return value;
      }
      default:
        throw new Error(`Unknown CURLINFO type: 0x${infoType.toString(16)}`);
    }
  }

  /**
   * Get response status code
   */
  getResponseCode(): number {
    return this.getInfo(CurlInfo.RESPONSE_CODE) as number;
  }

  /**
   * Get effective URL (after redirects)
   */
  getEffectiveUrl(): string | null {
    return this.getInfo(CurlInfo.EFFECTIVE_URL) as string | null;
  }

  /**
   * Get content type from response
   */
  getContentType(): string | null {
    return this.getInfo(CurlInfo.CONTENT_TYPE) as string | null;
  }

  /**
   * Get total transfer time in seconds
   */
  getTotalTime(): number {
    return this.getInfo(CurlInfo.TOTAL_TIME) as number;
  }

  /**
   * Get primary IP address
   */
  getPrimaryIp(): string | null {
    return this.getInfo(CurlInfo.PRIMARY_IP) as string | null;
  }

  /**
   * Get primary port
   */
  getPrimaryPort(): number {
    return this.getInfo(CurlInfo.PRIMARY_PORT) as number;
  }

  /**
   * Get local IP address
   */
  getLocalIp(): string | null {
    return this.getInfo(CurlInfo.LOCAL_IP) as string | null;
  }

  /**
   * Get local port
   */
  getLocalPort(): number {
    return this.getInfo(CurlInfo.LOCAL_PORT) as number;
  }

  /**
   * Get redirect count
   */
  getRedirectCount(): number {
    return this.getInfo(CurlInfo.REDIRECT_COUNT) as number;
  }

  /**
   * Get redirect URL (if any)
   */
  getRedirectUrl(): string | null {
    return this.getInfo(CurlInfo.REDIRECT_URL) as string | null;
  }

  /**
   * Get HTTP version used
   */
  getHttpVersion(): number {
    return this.getInfo(CurlInfo.HTTP_VERSION) as number;
  }

  /**
   * Set write callback function
   */
  setWriteFunction(fn: WriteCallback): void {
    const cb = wrapWriteCallback(fn);
    this._callbacks.push(cb);
    this.setOpt(CurlOpt.WRITEFUNCTION, cb);
  }

  /**
   * Set header callback function
   */
  setHeaderFunction(fn: WriteCallback): void {
    const cb = wrapWriteCallback(fn);
    this._callbacks.push(cb);
    this.setOpt(CurlOpt.HEADERFUNCTION, cb);
  }

  /**
   * Set HTTP headers from array of "Header: Value" strings
   */
  setHeaders(headers: string[]): void {
    if (!headers || !headers.length) {
      return;
    }

    const list = new SList();
    headers.forEach((header) => list.append(header));
    this._slists.push(list);
    this.setOpt(CurlOpt.HTTPHEADER, list.pointer);
  }

  /**
   * Enable browser impersonation (requires curl-impersonate)
   * @param target Browser target (e.g., "chrome124", "firefox120", "safari17_0")
   * @param defaultHeaders Whether to add default browser headers (default: true)
   */
  impersonate(target: string, defaultHeaders: boolean = true): void {
    if (!curl_easy_impersonate) {
      throw new Error(
        "Browser impersonation not available. " +
        "Make sure you're using libcurl-impersonate instead of standard libcurl."
      );
    }

    if (!this.handle) {
      throw new Error("Curl handle is null");
    }

    const code = curl_easy_impersonate(this.handle, target, defaultHeaders ? 1 : 0);
    raiseIfError(code);
  }

  /**
   * Check if impersonation is available
   */
  static hasImpersonateSupport(): boolean {
    return hasImpersonateSupport();
  }

  /**
   * Perform the request synchronously
   */
  perform(): void {
    if (!this.handle) {
      throw new Error("Curl handle is null");
    }
    raiseIfError(curl_easy_perform(this.handle) as number);
  }

  /**
   * Reset the handle to initial state for reuse
   * Clears all options but keeps connections alive
   */
  reset(): void {
    if (!this.handle) {
      throw new Error("Curl handle is null");
    }

    // Free slists and clear callbacks
    this._slists.forEach((list) => list.free());
    this._slists = [];
    this._callbacks = [];
    this._buffers = [];

    curl_easy_reset(this.handle);
  }

  /**
   * Duplicate this curl handle
   * Returns a new Curl instance with the same options
   */
  dupHandle(): Curl {
    if (!this.handle) {
      throw new Error("Curl handle is null");
    }

    const newHandle = curl_easy_duphandle(this.handle);
    if (!newHandle) {
      throw new Error("curl_easy_duphandle failed");
    }

    return new Curl({ fromHandle: newHandle });
  }

  /**
   * Apply JA3 TLS fingerprint
   *
   * JA3 format: tls_version,ciphers,extensions,curves,curve_formats
   * Example: 771,4865-4866-4867-49195-49199,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0
   *
   * Requires curl-impersonate for full extension control.
   *
   * @param ja3 - JA3 fingerprint string
   * @param permute - If true, don't enforce extension order (allows random permutation)
   */
  setJa3(ja3: string, permute: boolean = false): void {
    // Lazy import to avoid circular dependency
    const { setJa3Options } = require("../utils/fingerprint.js");
    setJa3Options(this, ja3, permute);
  }

  /**
   * Apply Akamai HTTP/2 fingerprint
   *
   * Akamai format: settings|window_update|streams|header_order
   * Example: 1:65536;3:1000;4:6291456;6:262144|15663105|0|m,a,s,p
   *
   * Requires curl-impersonate.
   *
   * @param akamai - Akamai fingerprint string
   */
  setAkamai(akamai: string): void {
    // Lazy import to avoid circular dependency
    const { setAkamaiOptions } = require("../utils/fingerprint.js");
    setAkamaiOptions(this, akamai);
  }

  /**
   * Apply extra fingerprint options for fine-grained TLS/HTTP2 control
   *
   * Requires curl-impersonate.
   *
   * @param options - Extra fingerprint configuration
   */
  setExtraFingerprint(options: ExtraFingerprint): void {
    // Lazy import to avoid circular dependency
    const { setExtraFingerprintOptions } = require("../utils/fingerprint.js");
    setExtraFingerprintOptions(this, options);
  }

  /**
   * Cleanup and release resources
   */
  cleanup(): void {
    this._slists.forEach((list) => list.free());
    this._slists = [];
    this._callbacks = [];
    this._buffers = [];

    if (this.handle) {
      curl_easy_cleanup(this.handle);
      this.handle = null;
    }
  }

  /**
   * Get libcurl version string
   */
  static version(): string {
    return (curl_version() as string | null) || "unknown";
  }

  /**
   * Get detailed version information
   */
  static versionInfo(): unknown {
    return curl_version_info(CurlVersion.CURLVERSION_NOW);
  }
}

// Re-export for convenience
export { CurlOpt, CurlInfo, CurlCode };
