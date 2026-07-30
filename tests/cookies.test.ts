/**
 * Tests for Cookies class
 */
import { Cookies } from "../src/http/cookies.js";

describe("Cookies", () => {
  describe("constructor", () => {
    it("should create empty cookies", () => {
      const cookies = new Cookies();
      expect(cookies.toObject()).toEqual({});
    });

    it("should initialize from object", () => {
      const cookies = new Cookies({
        session: "abc123",
        user: "john",
      });
      expect(cookies.get("session")).toBe("abc123");
      expect(cookies.get("user")).toBe("john");
    });

    it("should initialize from another Cookies instance", () => {
      const original = new Cookies({ session: "abc123" });
      const copy = new Cookies(original);
      expect(copy.get("session")).toBe("abc123");
    });
  });

  describe("get and set", () => {
    it("should get cookie value", () => {
      const cookies = new Cookies();
      cookies.set("session", "abc123");
      expect(cookies.get("session")).toBe("abc123");
    });

    it("should return null for missing cookie", () => {
      const cookies = new Cookies();
      expect(cookies.get("missing")).toBeNull();
    });

    it("should set cookie with options", () => {
      const cookies = new Cookies();
      cookies.set("session", "abc123", {
        domain: "example.com",
        path: "/api",
        secure: true,
        httpOnly: true,
        expires: new Date("2030-01-01"),
      });
      const cookie = cookies.getCookie("session", "example.com", "/api");
      expect(cookie?.value).toBe("abc123");
      expect(cookie?.domain).toBe("example.com");
      expect(cookie?.path).toBe("/api");
      expect(cookie?.secure).toBe(true);
      expect(cookie?.httpOnly).toBe(true);
    });
  });

  describe("has and delete", () => {
    it("should check existence with has()", () => {
      const cookies = new Cookies({ session: "abc123" });
      expect(cookies.has("session")).toBe(true);
      expect(cookies.has("missing")).toBe(false);
    });

    it("should remove with delete()", () => {
      const cookies = new Cookies({ session: "abc123" });
      cookies.delete("session");
      expect(cookies.has("session")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all cookies", () => {
      const cookies = new Cookies({
        session: "abc123",
        user: "john",
      });
      cookies.clear();
      expect(cookies.toObject()).toEqual({});
    });
  });

  describe("iteration", () => {
    it("should iterate over all cookies", () => {
      const cookies = new Cookies({
        session: "abc123",
        user: "john",
      });
      const collected: string[] = [];
      for (const cookie of cookies) {
        collected.push(cookie.name);
      }
      expect(collected.length).toBe(2);
      expect(collected).toContain("session");
      expect(collected).toContain("user");
    });
  });

  describe("toCookieHeader", () => {
    it("should format as cookie header string", () => {
      const cookies = new Cookies({
        session: "abc123",
        user: "john",
      });
      const header = cookies.toCookieHeader();
      expect(header).toContain("session=abc123");
      expect(header).toContain("user=john");
    });
  });

  describe("URL matching", () => {
    it("should get cookies for URL", () => {
      const cookies = new Cookies();
      cookies.set("global", "value1", { domain: "example.com" });
      cookies.set("api", "value2", { domain: "api.example.com" });
      cookies.set("other", "value3", { domain: "other.com" });

      const forUrl = cookies.getForUrl("https://api.example.com/test");
      const names = forUrl.map((c) => c.name);
      expect(names).toContain("api");
    });

    it("should match path", () => {
      const cookies = new Cookies();
      cookies.set("root", "value1", { path: "/" });
      cookies.set("api", "value2", { path: "/api" });

      const forRoot = cookies.getForUrl("https://example.com/");
      const rootNames = forRoot.map((c) => c.name);
      expect(rootNames).toContain("root");
      expect(rootNames).not.toContain("api");

      const forApi = cookies.getForUrl("https://example.com/api/users");
      const apiNames = forApi.map((c) => c.name);
      expect(apiNames).toContain("root");
      expect(apiNames).toContain("api");
    });
  });

  describe("parseSetCookie", () => {
    it("should parse Set-Cookie header", () => {
      const cookie = Cookies.parseSetCookie("session=abc123; Path=/; HttpOnly");
      expect(cookie.name).toBe("session");
      expect(cookie.value).toBe("abc123");
      expect(cookie.path).toBe("/");
      expect(cookie.httpOnly).toBe(true);
    });

    it("should parse Set-Cookie with domain", () => {
      const cookie = Cookies.parseSetCookie("user=john; Domain=example.com; Secure");
      expect(cookie.name).toBe("user");
      expect(cookie.value).toBe("john");
      expect(cookie.domain).toBe("example.com");
      expect(cookie.secure).toBe(true);
    });
  });

  describe("RFC 6265 domain dot handling", () => {
    it("should strip leading dot from domain on set()", () => {
      const cookies = new Cookies();
      cookies.set("session", "abc", { domain: ".example.com" });
      const cookie = cookies.getCookie("session");
      expect(cookie?.domain).toBe("example.com");
    });

    it("should deduplicate dotted and dotless domains", () => {
      const cookies = new Cookies();
      cookies.set("session", "first", { domain: ".example.com" });
      cookies.set("session", "second", { domain: "example.com" });
      expect(cookies.size).toBe(1);
      expect(cookies.get("session")).toBe("second");
    });

    it("should find cookie regardless of dot prefix in get()", () => {
      const cookies = new Cookies();
      cookies.set("session", "abc", { domain: "example.com" });
      expect(cookies.get("session", ".example.com")).toBe("abc");

      const cookies2 = new Cookies();
      cookies2.set("session", "abc", { domain: ".example.com" });
      expect(cookies2.get("session", "example.com")).toBe("abc");
    });

    it("should normalize domain in getCookie() lookup", () => {
      const cookies = new Cookies();
      cookies.set("session", "abc", { domain: ".example.com" });
      const cookie = cookies.getCookie("session", ".example.com", "/");
      expect(cookie).not.toBeNull();
      expect(cookie?.domain).toBe("example.com");
    });

    it("should delete cookie using dotted domain", () => {
      const cookies = new Cookies();
      cookies.set("session", "abc", { domain: ".example.com" });
      cookies.delete("session", ".example.com");
      expect(cookies.has("session")).toBe(false);
    });

    it("should strip leading dot in parseSetCookie()", () => {
      const cookie = Cookies.parseSetCookie("session=abc; Domain=.example.com");
      expect(cookie.domain).toBe("example.com");
    });

    it("should match subdomains via getForUrl()", () => {
      const cookies = new Cookies();
      cookies.set("token", "xyz", { domain: ".sub.example.com" });

      const exact = cookies.getForUrl("https://sub.example.com/");
      expect(exact.map((c) => c.name)).toContain("token");

      const deep = cookies.getForUrl("https://deep.sub.example.com/");
      expect(deep.map((c) => c.name)).toContain("token");

      const parent = cookies.getForUrl("https://example.com/");
      expect(parent.map((c) => c.name)).not.toContain("token");
    });

    it("should match domains case-insensitively", () => {
      const cookies = new Cookies();
      cookies.set("token", "xyz", { domain: ".Example.COM" });

      const matched = cookies.getForUrl("https://example.com/");
      expect(matched.map((c) => c.name)).toContain("token");
    });

    it("should normalize dotted domains from Netscape format", () => {
      const text = ".example.com\tTRUE\t/\tFALSE\t0\tsession\tabc";
      const cookies = Cookies.fromNetscapeFormat(text);
      const cookie = cookies.getCookie("session");
      expect(cookie?.domain).toBe("example.com");
    });

    it("should export normalized domain in Netscape format", () => {
      const cookies = new Cookies();
      cookies.set("session", "abc", { domain: ".example.com" });
      const output = cookies.toNetscapeFormat();
      expect(output).toContain("example.com");
      expect(output).not.toMatch(/\t\.example\.com\t/);
    });
  });

  describe("host-only vs. Domain-attribute cookie coexistence", () => {
    it("keeps a host-only and a Domain-attribute cookie of the same name/path/domain as two records", () => {
      // NOTE: both cookies here are explicitly given the SAME domain value
      // ("example.com") so this genuinely exercises the collision makeKey()
      // is supposed to resolve. An earlier version of this test omitted
      // `domain` on the host-only cookie, which passes trivially even
      // without this patch (the two calls end up with different domain
      // values -- "" vs "example.com" -- so makeKey() would separate them
      // either way, regardless of whether domainSpecified exists). See the
      // spec's "Concrete repro" note about this exact pitfall.
      const cookies = new Cookies();
      cookies.set("sess", "host-only-value", { path: "/", domain: "example.com", domainSpecified: false });
      cookies.set("sess", "domain-value", { path: "/", domain: "example.com", domainSpecified: true });
      expect(cookies.size).toBe(2);
    });

    it("marks a cookie from parseSetCookie without a Domain attribute as domainSpecified: false", () => {
      const cookie = Cookies.parseSetCookie(
        "sess=abc",
        new URL("https://api.example.com/")
      );
      expect(cookie.domain).toBe("api.example.com");
      expect(cookie.domainSpecified).toBe(false);
    });

    it("marks a cookie from parseSetCookie with an explicit Domain attribute as domainSpecified: true", () => {
      const cookie = Cookies.parseSetCookie(
        "sess=abc; Domain=example.com",
        new URL("https://api.example.com/")
      );
      expect(cookie.domain).toBe("example.com");
      expect(cookie.domainSpecified).toBe(true);
    });

    it("preserves domainSpecified through the Netscape format round-trip for both cookie kinds", () => {
      // Both cookies are given the SAME domain value here, deliberately —
      // this is the real shape parseSetCookie()'s request-hostname fallback
      // produces for a host-only cookie (domain backfilled from the URL,
      // domainSpecified explicitly false). A host-only cookie with no domain
      // at all doesn't discriminate old (`cookie.domain ? "TRUE" : "FALSE"`)
      // from new (`cookie.domainSpecified ? ...`) toNetscapeFormat() logic,
      // since `cookie.domain` and `cookie.domainSpecified` agree by
      // construction in that case.
      const original = new Cookies();
      original.set("host_only", "a", { path: "/", domain: "example.com", domainSpecified: false });
      original.set("domain_scoped", "b", { path: "/", domain: "example.com" });

      const restored = Cookies.fromNetscapeFormat(original.toNetscapeFormat());

      expect(restored.getCookie("host_only")?.domainSpecified).toBeFalsy();
      expect(restored.getCookie("domain_scoped")?.domainSpecified).toBe(true);
    });

    it("reproduces the bug via the actual parseSetCookie() -> set() production path (response.ts:119-124)", () => {
      // This is the realistic trigger path — see the spec's "Concrete repro"
      // and "Correction" notes. A repro built from direct set() calls with
      // hand-built options does NOT exercise this and will pass even when
      // the underlying bug (missing `domainSpecified = false` in the
      // request-hostname fallback) is present.
      const url = new URL("https://example.com/");
      const hostOnly = Cookies.parseSetCookie("sess=host-only-value", url);
      const domainScoped = Cookies.parseSetCookie(
        "sess=domain-value; Domain=example.com",
        url
      );

      const jar = new Cookies();
      jar.set(hostOnly.name, hostOnly.value, hostOnly);
      jar.set(domainScoped.name, domainScoped.value, domainScoped);

      expect(jar.size).toBe(2);
    });

    it("resolves get()/getCookie() for a colliding pair by insertion order, regardless of which one is host-only", () => {
      // Regression guard: an earlier draft of this fix left get()/getCookie()
      // an "exact key" fast path that queries with the caller's literal
      // domain argument. Since that path computed its lookup key with
      // domainSpecified defaulting to false, it would return whichever
      // record happened to be host-only, independent of insertion order --
      // contradicting the linear-scan fallback's own first-match semantics
      // for every other case. Both orderings must agree with "first
      // inserted wins".
      const domainFirst = new Cookies();
      domainFirst.set("sess", "domain-value", { path: "/", domain: "example.com" });
      domainFirst.set("sess", "host-only-value", { path: "/" });
      expect(domainFirst.get("sess")).toBe("domain-value");
      expect(domainFirst.getCookie("sess")?.value).toBe("domain-value");

      const hostOnlyFirst = new Cookies();
      hostOnlyFirst.set("sess", "host-only-value", { path: "/" });
      hostOnlyFirst.set("sess", "domain-value", { path: "/", domain: "example.com" });
      expect(hostOnlyFirst.get("sess")).toBe("host-only-value");
      expect(hostOnlyFirst.getCookie("sess")?.value).toBe("host-only-value");
    });

    it("still deduplicates two Domain-attribute cookies that differ only by leading dot", () => {
      // Regression guard: this existing behavior (see the "RFC 6265 domain dot
      // handling" describe block, "should deduplicate dotted and dotless
      // domains") must not change — both cookies here are domain-specified,
      // so they still collide on the same key as before this patch.
      const cookies = new Cookies();
      cookies.set("session", "first", { domain: ".example.com" });
      cookies.set("session", "second", { domain: "example.com" });
      expect(cookies.size).toBe(1);
      expect(cookies.get("session")).toBe("second");
    });

    it("still prefers an exact domain/path match over a broader fuzzy match, independent of insertion order (regression guard, Revision note 2)", () => {
      // Regression guard for the exact-key fast-path removal above (see
      // "get()/getCookie()/delete() disambiguation"): this must keep working
      // for ORDINARY callers, unrelated to host-only cookies or this patch's
      // own collision case. Requires the two-pass exact-then-fuzzy fix.
      const broadFirst = new Cookies();
      broadFirst.set("sess", "broad", { domain: "example.com" });
      broadFirst.set("sess", "specific", { domain: "app.example.com" });
      expect(broadFirst.get("sess", "app.example.com")).toBe("specific");

      const specificFirst = new Cookies();
      specificFirst.set("sess", "specific", { domain: "app.example.com" });
      specificFirst.set("sess", "broad", { domain: "example.com" });
      expect(specificFirst.get("sess", "app.example.com")).toBe("specific");
    });

    it("documents a known, currently out-of-scope gap: getForUrl() still sends a host-only cookie to a subdomain (Revision note 2)", () => {
      // KNOWN GAP, not fixed by this patch — tracked separately under
      // "Explicitly out of scope" in this spec. This test documents CURRENT
      // behavior, not desired behavior: it will need to flip to `.toBe(false)`
      // once matchesDomain()/getForUrl() are taught to consult
      // domainSpecified in that separate follow-up. Do not "fix" this by
      // changing matchesDomain() as part of this PR.
      const cookies = new Cookies();
      cookies.set("sess", "host-only-value", { domain: "example.com", domainSpecified: false });
      const matches = cookies.getForUrl("https://sub.example.com/");
      expect(matches.some((c) => c.value === "host-only-value")).toBe(true);
    });

    it("delete() does not cascade across an omitted path when scoping by domain, and still deletes both records of an exact collision", () => {
      // Regression guard: matchesExactScope() treats an omitted domain/path
      // argument as "unconstrained on that axis" -- fine for get()/getCookie()
      // (they return at most one value either way) but destructive for
      // delete() if pass 1 scanned with it, since it would delete every
      // cookie fuzzy-matching the omitted axis instead of only the exact
      // match. delete()'s pass 1 avoids this by NOT scanning at all: it
      // builds the exact Map key(s) set() would have used (domain as given,
      // path defaulting to "/" the same way the old pre-patch fast path did)
      // and looks each one up directly, trying both domainSpecified values
      // to catch a genuine collision. A direct key lookup can't cascade
      // regardless of which arguments are supplied -- it either hits the
      // literal key(s) or it doesn't -- which is what keeps the omitted-path
      // case below scoped to a single cookie, matching pre-patch behavior
      // exactly.
      const byPath = new Cookies();
      byPath.set("sess", "root", { domain: "example.com", path: "/" });
      byPath.set("sess", "api", { domain: "example.com", path: "/api" });
      byPath.delete("sess", "example.com"); // path omitted
      // Pre-patch: only the path="/" cookie was removed via the exact-key
      // fast path; the "/api" cookie survived. Must still hold post-patch.
      expect(byPath.size).toBe(1);
      expect(byPath.getCookie("sess", "example.com", "/api")?.value).toBe("api");

      // The collision case pass 1 exists for: both domain AND path supplied,
      // exactly matching both records -- both must still be deleted in one
      // call.
      const collision = new Cookies();
      collision.set("sess", "host-only-value", { domain: "example.com", path: "/", domainSpecified: false });
      collision.set("sess", "domain-value", { domain: "example.com", path: "/", domainSpecified: true });
      expect(collision.size).toBe(2);
      collision.delete("sess", "example.com", "/");
      expect(collision.size).toBe(0);
    });
  });
});
