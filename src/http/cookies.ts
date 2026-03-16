/**
 * HTTP Cookie jar with domain/path support
 */

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface CookieOptions {
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export type CookiesInit =
  | Cookies
  | Record<string, string>
  | Iterable<[string, string]>
  | Cookie[];

/**
 * Cookies - HTTP cookie jar with domain and path matching
 */
export class Cookies implements Iterable<Cookie> {
  private cookies: Map<string, Cookie> = new Map();

  constructor(init?: CookiesInit) {
    if (init) {
      this.update(init);
    }
  }

  /**
   * Generate a unique key for a cookie.
   * Strips leading dot from domain per RFC 6265 §5.2.3.
   */
  private makeKey(name: string, domain?: string, path?: string): string {
    const normalizedDomain = domain?.replace(/^\./, "") || "";
    return `${normalizedDomain}|${path || "/"}|${name}`;
  }

  /**
   * Set a cookie
   */
  set(name: string, value: string, options?: CookieOptions): void {
    const cookie: Cookie = {
      name,
      value,
      domain: options?.domain?.replace(/^\./, "") || undefined,
      path: options?.path || "/",
      expires: options?.expires,
      maxAge: options?.maxAge,
      secure: options?.secure,
      httpOnly: options?.httpOnly,
      sameSite: options?.sameSite,
    };

    const key = this.makeKey(name, cookie.domain, cookie.path);
    this.cookies.set(key, cookie);
  }

  /**
   * Get a cookie value
   */
  get(name: string, domain?: string, path?: string): string | null {
    // Try exact match first
    const key = this.makeKey(name, domain, path);
    const exact = this.cookies.get(key);
    if (exact) {
      return exact.value;
    }

    // Search for matching cookie
    for (const cookie of this.cookies.values()) {
      if (cookie.name !== name) continue;

      if (domain && cookie.domain && !this.matchesDomain(cookie.domain, domain)) {
        continue;
      }

      if (path && cookie.path && !this.matchesPath(cookie.path, path)) {
        continue;
      }

      return cookie.value;
    }

    return null;
  }

  /**
   * Get a cookie object
   */
  getCookie(name: string, domain?: string, path?: string): Cookie | null {
    const key = this.makeKey(name, domain, path);
    const exact = this.cookies.get(key);
    if (exact) {
      return exact;
    }

    for (const cookie of this.cookies.values()) {
      if (cookie.name !== name) continue;

      if (domain && cookie.domain && !this.matchesDomain(cookie.domain, domain)) {
        continue;
      }

      if (path && cookie.path && !this.matchesPath(cookie.path, path)) {
        continue;
      }

      return cookie;
    }

    return null;
  }

  /**
   * Delete a cookie
   */
  delete(name: string, domain?: string, path?: string): boolean {
    const key = this.makeKey(name, domain, path);
    if (this.cookies.has(key)) {
      return this.cookies.delete(key);
    }

    // Delete all matching cookies
    let deleted = false;
    for (const [key, cookie] of this.cookies) {
      if (cookie.name !== name) continue;

      if (domain && cookie.domain && !this.matchesDomain(cookie.domain, domain)) {
        continue;
      }

      if (path && cookie.path && !this.matchesPath(cookie.path, path)) {
        continue;
      }

      this.cookies.delete(key);
      deleted = true;
    }

    return deleted;
  }

  /**
   * Clear all cookies, optionally filtering by domain/path
   */
  clear(domain?: string, path?: string): void {
    if (!domain && !path) {
      this.cookies.clear();
      return;
    }

    for (const [key, cookie] of this.cookies) {
      if (domain && cookie.domain && !this.matchesDomain(cookie.domain, domain)) {
        continue;
      }

      if (path && cookie.path && !this.matchesPath(cookie.path, path)) {
        continue;
      }

      this.cookies.delete(key);
    }
  }

  /**
   * Check if a cookie exists
   */
  has(name: string, domain?: string, path?: string): boolean {
    return this.get(name, domain, path) !== null;
  }

  /**
   * Update cookies from another source
   */
  update(init: CookiesInit): void {
    if (init instanceof Cookies) {
      for (const cookie of init) {
        this.set(cookie.name, cookie.value, cookie);
      }
    } else if (Array.isArray(init)) {
      for (const item of init) {
        if (typeof item === "object" && "name" in item && "value" in item) {
          this.set(item.name, item.value, item);
        }
      }
    } else if (typeof init === "object") {
      if (Symbol.iterator in init) {
        for (const [name, value] of init as Iterable<[string, string]>) {
          this.set(name, value);
        }
      } else {
        for (const [name, value] of Object.entries(init)) {
          this.set(name, value);
        }
      }
    }
  }

  /**
   * Get cookies matching a URL
   */
  getForUrl(url: string | URL): Cookie[] {
    const parsedUrl = typeof url === "string" ? new URL(url) : url;
    const hostname = parsedUrl.hostname;
    const pathname = parsedUrl.pathname || "/";
    const isSecure = parsedUrl.protocol === "https:";
    const now = new Date();

    return [...this.cookies.values()].filter((cookie) => {
      // Check domain match
      if (cookie.domain && !this.matchesDomain(cookie.domain, hostname)) {
        return false;
      }

      // Check path match
      if (cookie.path && !this.matchesPath(cookie.path, pathname)) {
        return false;
      }

      // Check secure flag
      if (cookie.secure && !isSecure) {
        return false;
      }

      // Check expiration
      if (cookie.expires && cookie.expires < now) {
        return false;
      }

      return true;
    });
  }

  /**
   * Check if cookie domain matches request domain
   */
  private matchesDomain(cookieDomain: string, requestDomain: string): boolean {
    // Normalize domains
    const cookie = cookieDomain.toLowerCase().replace(/^\./, "");
    const request = requestDomain.toLowerCase();

    // Exact match
    if (cookie === request) {
      return true;
    }

    // Subdomain match (cookie domain .example.com matches sub.example.com)
    if (request.endsWith("." + cookie)) {
      return true;
    }

    return false;
  }

  /**
   * Check if cookie path matches request path
   */
  private matchesPath(cookiePath: string, requestPath: string): boolean {
    // Exact match
    if (cookiePath === requestPath) {
      return true;
    }

    // Path prefix match
    if (requestPath.startsWith(cookiePath)) {
      // Ensure we're matching at a path boundary
      if (cookiePath.endsWith("/")) {
        return true;
      }
      if (requestPath[cookiePath.length] === "/") {
        return true;
      }
    }

    return false;
  }

  /**
   * Convert to Cookie header value
   */
  toCookieHeader(url?: string | URL): string {
    const cookies = url ? this.getForUrl(url) : [...this.cookies.values()];
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  /**
   * Convert to Netscape cookie file format (for curl)
   */
  toNetscapeFormat(): string {
    const lines: string[] = [];

    for (const cookie of this.cookies.values()) {
      const domain = cookie.domain || "";
      const includeSubdomains = cookie.domain ? "TRUE" : "FALSE";
      const path = cookie.path || "/";
      const secure = cookie.secure ? "TRUE" : "FALSE";
      const expires = cookie.expires
        ? Math.floor(cookie.expires.getTime() / 1000).toString()
        : "0";

      lines.push(
        `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expires}\t${cookie.name}\t${cookie.value}`
      );
    }

    return lines.join("\n");
  }

  /**
   * Parse Set-Cookie header
   */
  static parseSetCookie(setCookie: string, requestUrl?: URL): Cookie {
    const parts = setCookie.split(";").map((p) => p.trim());
    const [nameValue, ...attrs] = parts;

    const eqIdx = nameValue.indexOf("=");
    const name = eqIdx > 0 ? nameValue.slice(0, eqIdx).trim() : nameValue;
    const value = eqIdx > 0 ? nameValue.slice(eqIdx + 1).trim() : "";

    const cookie: Cookie = { name, value };

    for (const attr of attrs) {
      const [attrName, attrValue] = attr.split("=").map((s) => s.trim());
      const lowerName = attrName.toLowerCase();

      switch (lowerName) {
        case "domain":
          cookie.domain = attrValue?.replace(/^\./, "") || undefined;
          break;
        case "path":
          cookie.path = attrValue;
          break;
        case "expires":
          cookie.expires = new Date(attrValue);
          break;
        case "max-age":
          cookie.maxAge = parseInt(attrValue, 10);
          if (!isNaN(cookie.maxAge)) {
            cookie.expires = new Date(Date.now() + cookie.maxAge * 1000);
          }
          break;
        case "secure":
          cookie.secure = true;
          break;
        case "httponly":
          cookie.httpOnly = true;
          break;
        case "samesite":
          if (["Strict", "Lax", "None"].includes(attrValue)) {
            cookie.sameSite = attrValue as "Strict" | "Lax" | "None";
          }
          break;
      }
    }

    // Default domain/path from request URL
    if (requestUrl) {
      if (!cookie.domain) {
        cookie.domain = requestUrl.hostname;
      }
      if (!cookie.path) {
        cookie.path = requestUrl.pathname.replace(/\/[^/]*$/, "") || "/";
      }
    }

    return cookie;
  }

  /**
   * Parse Netscape cookie file format
   */
  static fromNetscapeFormat(text: string): Cookies {
    const cookies = new Cookies();
    const lines = text.split("\n");

    for (const line of lines) {
      // Skip comments and empty lines
      if (!line || line.startsWith("#")) {
        continue;
      }

      const parts = line.split("\t");
      if (parts.length >= 7) {
        const [domain, , path, secure, expires, name, value] = parts;

        cookies.set(name, value, {
          domain,
          path,
          secure: secure === "TRUE",
          expires: expires !== "0" ? new Date(parseInt(expires, 10) * 1000) : undefined,
        });
      }
    }

    return cookies;
  }

  /**
   * Iterate over all cookies
   */
  *[Symbol.iterator](): IterableIterator<Cookie> {
    yield* this.cookies.values();
  }

  /**
   * Get all cookie names
   */
  *keys(): IterableIterator<string> {
    for (const cookie of this.cookies.values()) {
      yield cookie.name;
    }
  }

  /**
   * Get all cookie values
   */
  *values(): IterableIterator<string> {
    for (const cookie of this.cookies.values()) {
      yield cookie.value;
    }
  }

  /**
   * Get name-value entries
   */
  *entries(): IterableIterator<[string, string]> {
    for (const cookie of this.cookies.values()) {
      yield [cookie.name, cookie.value];
    }
  }

  /**
   * Get number of cookies
   */
  get size(): number {
    return this.cookies.size;
  }

  /**
   * Convert to plain object
   */
  toObject(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const cookie of this.cookies.values()) {
      result[cookie.name] = cookie.value;
    }
    return result;
  }

  /**
   * Create a copy
   */
  clone(): Cookies {
    const copy = new Cookies();
    for (const cookie of this.cookies.values()) {
      copy.set(cookie.name, cookie.value, cookie);
    }
    return copy;
  }
}
