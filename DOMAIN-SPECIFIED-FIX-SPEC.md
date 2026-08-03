# impers: preserve host-only vs. Domain-attribute cookie identity

> **Scope note.** This spec was deliberately narrowed after an earlier, broader
> attempt at this same problem (`fix/host-only-domain-specified-cookie-identity`,
> closed as PR [lexiforest/impers#26](https://github.com/lexiforest/impers/pull/26)
> without merging). That attempt also changed `makeKey()`'s storage key and
> added a two-pass exact/fuzzy resolution to `get()`/`getCookie()`/`delete()`
> to handle a same-name storage collision. This spec deliberately drops all of
> that. **The only goal here is: store the same host-only/domain-scope bit a
> real browser stores, and use it the same way a real browser uses it when
> deciding where a cookie gets sent.** No storage-key changes, no
> collision-avoidance logic — see "What this deliberately does not do" below
> for why that's safe to skip.

## The problem

`impers`'s cookie jar (`src/http/cookies.ts`) parses every `Set-Cookie`
response into a `Cookie` object with a `domain` field — but that field is
**always a bare hostname string**, whether or not the server actually sent a
`Domain=` attribute:

```ts
// case "domain": (line 343) — explicit attribute
cookie.domain = attrValue?.replace(/^\./, "") || undefined;

// fallback (line 372-380) — no attribute at all
if (requestUrl) {
  if (!cookie.domain) {
    cookie.domain = requestUrl.hostname;
  }
  ...
}
```

Both branches produce the same shape: a plain string with no leading dot. A
consumer reading a parsed `Cookie` object has **no way to tell** whether that
domain came from an explicit `Domain=` attribute (should apply to the domain
*and all its subdomains*, per RFC 6265 §5.3) or was inferred from the request
host with no attribute present (should apply to *that exact host only*).

This matters because real browsers track this distinction and use it in two
different places:

1. **Storage** — Chrome's own cookie inspector shows a leading dot
   (`.example.com`) for `Domain=`-scoped cookies and no dot (`example.com`)
   for host-only ones. It's a real, persisted bit of state, not a display
   quirk.
2. **Send scope** — a host-only cookie set on `example.com` is never sent to
   `sub.example.com`; a `Domain=example.com` cookie is sent to both.

`impers` currently does neither. Concretely, for a downstream consumer that
persists `impers`'s cookies into its own storage and later needs to know
"was this host-only," there is nothing to read — the information was
discarded during parsing.

**Confirmed against real traffic**, not just theoretically: a live OnlyFans
session captured via this library showed `_cfuvid`, `__cf_bm`, `fp`, `lang`,
and `st` all arriving with an explicit `Domain=onlyfans.com` attribute
(confirmed via the actual browser's cookie store — Chrome shows
`.onlyfans.com` for these), while `csrf`, `auth_id`, and `sess` are host-only
(`onlyfans.com`, no dot). A consumer reading these back out of `impers`'s
`Cookie` objects cannot distinguish the two groups — both surface as
`domain: "onlyfans.com"`.

## The fix — storage

Add an explicit `domainSpecified: boolean` field that records which case
produced the domain, and set it in both places `domain` currently gets set.

### 1. `Cookie` / `CookieOptions` interfaces (`src/http/cookies.ts:5-25`)

```ts
export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  domainSpecified?: boolean; // true: Domain attribute was explicit; false/absent: host-only
  path?: string;
  expires?: Date;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface CookieOptions {
  domain?: string;
  domainSpecified?: boolean;
  path?: string;
  expires?: Date;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}
```

### 2. `set()` (`src/http/cookies.ts:57-72`)

Infer `domainSpecified` only when the caller didn't say explicitly, so every
existing call site keeps working unchanged:

```ts
set(name: string, value: string, options?: CookieOptions): void {
  const domain = options?.domain?.replace(/^\./, "") || undefined;
  const domainSpecified = options?.domainSpecified ?? Boolean(domain);
  const cookie: Cookie = {
    name,
    value,
    domain,
    domainSpecified,
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
```

Note `makeKey()` is **not** changed — see "What this deliberately does not
do" below.

### 3. `parseSetCookie()` (`src/http/cookies.ts:328-383`)

Set `domainSpecified = true` in the explicit-attribute branch:

```ts
case "domain":
  cookie.domain = attrValue?.replace(/^\./, "") || undefined;
  cookie.domainSpecified = true;
  break;
```

Set `domainSpecified = false` in the fallback branch — **this is the one
that's actually missing today** and is the direct cause of the bug:

```ts
if (requestUrl) {
  if (!cookie.domain) {
    cookie.domain = requestUrl.hostname;
    cookie.domainSpecified = false;
  }
  if (!cookie.path) {
    cookie.path = requestUrl.pathname.replace(/\/[^/]*$/, "") || "/";
  }
}
```

Without this second change, a host-only cookie parsed via `parseSetCookie()`
ends up with `domainSpecified: undefined`, and `set()`'s
`options?.domainSpecified ?? Boolean(domain)` fallback then reads `domain`
(now truthy, since it was just backfilled) and wrongly resolves `true`. Both
branches must change together, or the fix does nothing for the realistic
`parseSetCookie() → set()` path that every actual HTTP response goes through.

### 4. `clone()` / `update()` — no changes needed

Both already forward the full `Cookie` object as `options` to `.set()`
(`this.set(cookie.name, cookie.value, cookie)`), so once `Cookie` carries
`domainSpecified` and `set()` reads `options?.domainSpecified` first, these
two call sites carry it through with zero changes to their own bodies.

## The fix — send scope

Storing the bit is necessary but not sufficient. `getForUrl()` — the method
that decides which cookies actually get attached to an outgoing request
(traced below, this is the only place that decision gets made) — filters
through `matchesDomain()`, which currently has no concept of host-only at
all:

```ts
// src/http/cookies.ts:253-265 — current
private matchesDomain(cookieDomain: string, requestDomain: string): boolean {
  const cookie = cookieDomain.toLowerCase().replace(/^\./, "");
  const request = requestDomain.toLowerCase();
  if (cookie === request) return true;
  if (request.endsWith("." + cookie)) return true;
  return false;
}
```

Any cookie with a `domain` set — host-only or not — matches a subdomain
request today. This means a host-only cookie set on `onlyfans.com` is
currently sent to a request against `ws2.onlyfans.com` or
`static2.onlyfans.com`, which a real browser would never do.

Fix — consult `domainSpecified`, only allowing the subdomain match when it's
`true`:

```ts
private matchesDomain(cookieDomain: string, requestDomain: string, domainSpecified?: boolean): boolean {
  const cookie = cookieDomain.toLowerCase().replace(/^\./, "");
  const request = requestDomain.toLowerCase();
  if (cookie === request) return true;
  if (domainSpecified && request.endsWith("." + cookie)) return true;
  return false;
}
```

And thread the extra argument through `getForUrl()` (`src/http/cookies.ts:218-248`,
the only caller):

```ts
if (cookie.domain && !this.matchesDomain(cookie.domain, hostname, cookie.domainSpecified)) {
  return false;
}
```

`get()`/`getCookie()`/`delete()` also call `matchesDomain()` in their fuzzy
fallback passes, but those take an explicit `domain` argument from the
*caller* (not from another cookie's stored value) and answer "does this
stored cookie satisfy a domain the caller asked about," which is a different
question from "should this cookie be sent to this specific host." Changing
`getForUrl()`/`matchesDomain()` is what fixes the send-scope leak; the other
three methods are read/delete conveniences and don't affect wire behavior at
all — left untouched, consistent with the "minimal fix" goal.

## Where cookies actually reach curl (confirmed by reading the code, not assumed)

This determines whether the fix above is sufficient on its own, or whether a
consumer also needs to pre-filter cookies per request.

- `Session.execute()` calls `buildCookieHeader(url, options)`
  (`src/http/session.ts:148-151, 585-601`) for **every** request, before
  `curl.setOpt()` is ever touched:
  ```ts
  const cookies = new Cookies();
  const sessionCookies = this._cookies.getForUrl(url);   // <-- domain filtering happens HERE
  for (const cookie of sessionCookies) {
    cookies.set(cookie.name, cookie.value, cookie);
  }
  if (options.cookies) {
    cookies.update(options.cookies);
  }
  const header = cookies.toCookieHeader();                // flat "name=value; name2=value2" string
  ```
  `curl.setOpt(CurlOpt.COOKIE, cookieHeader)` then receives a plain string
  with **no domain information at all** — by the time curl sees anything,
  filtering has already happened entirely in JS via `getForUrl()`.
- `impers` never calls curl's native cookie-jar options. `COOKIELIST`,
  `COOKIEFILE`, `COOKIEJAR`, and `COOKIESESSION` are all defined as FFI
  constants (`src/ffi/constants.ts`) but **`CurlOpt.COOKIELIST` etc. are never
  referenced anywhere in `src/`** — confirmed by grepping the full source
  tree. `toNetscapeFormat()`/`fromNetscapeFormat()` exist and are exported
  from `public.ts`, but nothing in `src/` calls them internally; they're
  opt-in helpers for a consumer that wants to hand cookies to a *different*
  curl-based tool, not something `impers` itself uses for its own requests.

**This confirms the assumption behind why this fix is worth making at the
`Cookies` class level at all**: a consumer can safely hand an entire session's
cookie jar to one `Session` and trust `getForUrl()` to filter correctly per
request — cookies for `google.com` genuinely never get attached to an
`onlyfans.com` request, since `matchesDomain()` requires an exact host match
or (today, over-broadly) a real subdomain relationship. The gap this spec
fixes is *only* that the subdomain branch doesn't currently check
`domainSpecified` — everything else about "don't leak across unrelated
domains" already works correctly today, storage bug notwithstanding. No
per-call manual cookie filtering is needed before or after this fix, and
curl itself never needs to know about `Domain=` at all — the filtering
decision is fully resolved before `CurlOpt.COOKIE` is set.

## What this deliberately does not do, and why that's safe

The earlier, closed PR also changed `makeKey()` to fold `domainSpecified`
into the storage key, because without that, a host-only cookie and a
`Domain=`-attribute cookie **of the same name** collide and silently
overwrite each other in the backing `Map`. That's a real gap in general — but
it only matters when a server sends two same-named cookies that differ solely
in host-only-ness, which is a narrow, unconfirmed edge case (see the closed
PR's own discussion for why "real browsers behave this way" doesn't hold up
as a justification either — RFC 6265's own storage-replacement rule doesn't
key on host-only-ness).

For the actual problem this spec exists to fix — OnlyFans's cookies, all of
which have distinct names (`csrf`, `auth_id`, `sess`, `st`, `fp`, `lang`,
`_cfuvid`, `__cf_bm`, ...) — that collision never triggers. Adding
`domainSpecified` to `Cookie`/`CookieOptions` and fixing the two
`parseSetCookie()` branches is sufficient on its own; `makeKey()` doesn't
need to change, and neither do `get()`/`getCookie()`/`delete()`'s lookup
semantics. Skipping those avoids the exact-vs-fuzzy-match regression and the
three rounds of correction the closed PR needed to get that part right — this
version has no equivalent surface to get wrong.

If a same-name host-only/`Domain=` collision ever turns out to matter for a
real use case, that's a separate, independently-scoped fix — see the closed
PR (`fix/host-only-domain-specified-cookie-identity`, still present on this
fork's remote branches) for a fully-worked version of that change, including
its three rounds of review corrections.

## Trade-offs / costs

- **None found for the storage change.** `domainSpecified` is additive —
  optional on both interfaces, inferred with a backward-compatible default
  (`Boolean(domain)`) when a caller doesn't supply it, so no existing caller
  or test breaks.
- **The send-scope change is a behavior change**, not just additive: it makes
  `getForUrl()` **stricter** — a host-only cookie that today gets sent to
  subdomains will, after this fix, correctly stop being sent there. Any
  consumer that (perhaps unknowingly) currently depends on that leak — e.g.
  a workflow relying on a host-only cookie reaching a subdomain endpoint it
  was never actually scoped to — would need that cookie to legitimately
  become `Domain=`-scoped instead, or would need to set it directly on the
  subdomain. This should be flagged in the PR description as a behavior
  change, not framed as a pure bug fix, even though it is one relative to RFC
  6265 and real browsers.
- **No performance cost worth noting** — the added field is checked with a
  single boolean comparison in an already-existing filter predicate.
- No other trade-off was found. In particular, there is no evidence this was
  ever a deliberate design decision to omit — nothing in `git log` or code
  comments suggests `domainSpecified` was intentionally left out for a
  reason; it reads as a straightforward gap.

## Test plan

Add to `tests/cookies.test.ts`:

- `parseSetCookie()` without a `Domain` attribute → `domainSpecified: false`.
- `parseSetCookie()` with an explicit `Domain=` attribute → `domainSpecified: true`.
- `getForUrl()`: a host-only cookie set on `example.com` must **not** appear
  in results for `sub.example.com` (this is the regression test that fails
  today and should pass after the fix — the inverse of the "documents a known
  gap" test the closed PR added).
- `getForUrl()`: a `Domain=example.com` cookie must still appear in results
  for `sub.example.com` (regression guard — don't break the legitimate case).
- `clone()`: a cloned jar preserves `domainSpecified` per cookie.
- Run the full existing suite (`npm test`) afterward — in particular the
  existing `getForUrl`/subdomain-matching tests in the `RFC 6265 domain dot
  handling` describe block, to confirm nothing there regresses.

## Contribution mechanics

Same as before: target `lexiforest/impers`, files `src/http/cookies.ts` +
`tests/cookies.test.ts`. Given the send-scope behavior change noted above,
the PR description should lead with "this changes send behavior for
host-only cookies to match RFC 6265 / real browsers" rather than presenting
it as a purely additive fix.
