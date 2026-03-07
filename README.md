# impers

Node.js binding for [curl-impersonate](https://github.com/lexiforest/curl-impersonate)
via [Koffi](https://koffi.dev/). A TypeScript port of [curl_cffi](https://github.com/lexiforest/curl_cffi).

`impers` is an HTTP client library for Node.js that can impersonate browsers' TLS/JA3 and HTTP/2 fingerprints. If you are blocked by some website for no obvious reason, you can give `impers` a try.

Node.js 18+ is required.

> [!WARNING]
> `impers` is in a technical preview state, not even alpha. The docs may be inaccurate, All APIs are provisional, and subject to change.

## Features

- Supports JA3/TLS and HTTP/2 fingerprint impersonation, including recent browsers and custom fingerprints.
- Fast performance powered by libcurl.
- Supports HTTP/2 and HTTP/3. `impers` is probably the first Node package that support http/3.
- Supports WebSocket, with impersonation.
- TypeScript first with full type definitions.
- MIT licensed.

||node-fetch|axios|got|undici|impers|
|---|---|---|---|---|---|
|http/2|❌|❌|✅|✅|✅|
|http/3|❌|❌|❌|❌|✅|
|websocket|❌|❌|❌|✅|✅|
|fingerprints|❌|❌|❌|❌|✅|

## Impersonate Suite

`impers` is part of the impersonate suite.

- [curl-impersonate](https://github.com/lexiforest/curl-impersonate). A curl distribution that impersonates browsers.
- [curl_cffi](https://github.com/lexiforest/curl_cffi). Python binding to curl-impersonate.
- [impers](https://github.com/lexiforest/impers). Node.js binding to curl-impersonate.
- [impersonate.pro](https://impersonate.pro). Commercial support, more fingerprints and vibe crawling.

## Install

```sh
npm install impers
```

### Requirements

**libcurl-impersonate**: For full fingerprinting support, you need [curl-impersonate](https://github.com/lexiforest/curl-impersonate) installed. Standard libcurl works but without impersonation features.

Luckily, if you have a internet connection, `impers` will download curl-impersonate at the first launch.

If you will to use your own version, set the `LIBCURL_PATH` environment variable:

```sh
export LIBCURL_PATH=/path/to/libcurl-impersonate.so
```

## Usage

```typescript
import * as impers from "impers";

// Notice the impersonate parameter
const r = await impers.get("https://tls.peet.ws/api/all", { impersonate: "chrome" });

console.log(r.json());
// output: {..., "ja3_hash": "aa56c057ad164ec4fdcb7a5a283be9fc", ...}
// the JA3 fingerprint should be the same as the target browser

// To keep using the latest browser version as impers updates,
// simply set impersonate="chrome" without specifying a version.
// Other similar values are: "safari" and "firefox"
const r2 = await impers.get("https://tls.peet.ws/api/all", { impersonate: "chrome" });

// To pin a specific version, use version numbers together.
const r3 = await impers.get("https://tls.peet.ws/api/all", { impersonate: "chrome124" });

// To impersonate other than browsers, bring your own JA3/Akamai strings
// See examples directory for details.
const r4 = await impers.get("https://tls.peet.ws/api/all", {
  ja3: "771,4865-4866-4867-49195-49199,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
  akamai: "1:65536;3:1000;4:6291456;6:262144|15663105|0|m,a,s,p",
});

// HTTP/SOCKS proxies are supported
const r5 = await impers.get("https://tls.peet.ws/api/all", {
  impersonate: "chrome",
  proxy: "http://localhost:3128",
});

const r6 = await impers.get("https://tls.peet.ws/api/all", {
  impersonate: "chrome",
  proxy: "socks5://localhost:1080",
});
```

### Sessions

```typescript
import { Session } from "impers";

const session = new Session();

// httpbin is an HTTP test website, this endpoint makes the server set cookies
await session.get("https://httpbin.org/cookies/set/foo/bar");
console.log(session.cookies);
// Cookies { foo: 'bar' }

// retrieve cookies again to verify
const r = await session.get("https://httpbin.org/cookies");
console.log(r.json());
// { cookies: { foo: 'bar' } }

// Don't forget to close the session when done
await session.close();
```

### Supported Impersonate Browsers

`impers` supports the same browser versions as [curl-impersonate](https://github.com/lexiforest/curl-impersonate):

| Browser | Versions |
|---------|----------|
| Chrome | chrome99, chrome100, chrome101, chrome104, chrome107, chrome110, chrome116, chrome119, chrome120, chrome123, chrome124, chrome131, chrome133a, chrome136, chrome142 |
| Chrome Android | chrome99_android, chrome131_android |
| Safari | safari153, safari155, safari170, safari180, safari184, safari260, safari2601 |
| Safari iOS | safari172_ios, safari180_ios, safari184_ios, safari260_ios |
| Firefox | firefox133, firefox135, firefox144 |
| Tor | tor145 |
| Edge | edge99, edge101 |

If you are trying to impersonate a target other than a browser, use `ja3` and `akamai` options to specify your own customized fingerprints.

### Custom Fingerprints

```typescript
import * as impers from "impers";

// JA3 TLS fingerprint format: tls_version,ciphers,extensions,curves,curve_formats
const ja3 = "771,4865-4866-4867-49195-49199,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0";

// Akamai HTTP/2 fingerprint format: settings|window_update|streams|header_order
const akamai = "1:65536;3:1000;4:6291456;6:262144|15663105|0|m,a,s,p";

const r = await impers.get("https://tls.peet.ws/api/all", { ja3, akamai });

// For fine-grained control, use extraFp
const extraFp: impers.ExtraFingerprint = {
  tlsSigAlgs: ["ecdsa_secp256r1_sha256", "rsa_pss_rsae_sha256"],
  tlsSupportedGroups: ["X25519", "P-256", "P-384"],
  http2Settings: {
    1: 65536,   // HEADER_TABLE_SIZE
    3: 1000,    // MAX_CONCURRENT_STREAMS
    4: 6291456, // INITIAL_WINDOW_SIZE
    6: 262144,  // MAX_HEADER_LIST_SIZE
  },
  http2PseudoHeaderOrder: ["m", "a", "s", "p"],
};

const r2 = await impers.get("https://tls.peet.ws/api/all", { extraFp });
```

### Concurrent Requests

```typescript
import { Session } from "impers";

const urls = [
  "https://httpbin.org/get",
  "https://httpbin.org/ip",
  "https://httpbin.org/user-agent",
];

const session = new Session({ impersonate: "chrome124" });

try {
  const results = await Promise.all(
    urls.map(url => session.get(url))
  );

  for (const r of results) {
    console.log(r.status, r.url);
  }
} finally {
  await session.close();
}
```

### WebSockets

```typescript
import * as impers from "impers";

const ws = await impers.wsConnect("wss://echo.websocket.org", {
  impersonate: "chrome124",
});

await ws.send("Hello, World!");

for await (const message of ws) {
  console.log("Received:", message);
  if (message.type === "text" && message.data === "Hello, World!") {
    break;
  }
}

await ws.close();
```

### Low-level Curl API

```typescript
import { Curl, CurlOpt } from "impers";

const curl = new Curl();
const chunks: Buffer[] = [];

try {
  curl.setOpt(CurlOpt.URL, "https://example.com");
  curl.setWriteFunction((chunk) => chunks.push(Buffer.from(chunk)));

  // Browser impersonation (requires curl-impersonate)
  curl.impersonate("chrome124");

  // Or use manual fingerprinting
  // curl.setJa3("771,4865-4866-...");
  // curl.setAkamai("1:65536;...");

  curl.perform();
  console.log(Buffer.concat(chunks).toString());
} finally {
  curl.cleanup();
}
```

## API Reference

### Standalone Functions

```typescript
import * as impers from "impers";

// Generic request
const r = await impers.request("POST", url, options);

// Convenience methods
const r1 = await impers.get(url, options);
const r2 = await impers.post(url, { json: { key: "value" } });
const r3 = await impers.put(url, { data: { key: "value" } });
const r4 = await impers.del(url);
```

### Session

```typescript
import { Session } from "impers";

const session = new Session({
  baseUrl: "https://api.example.com",
  impersonate: "chrome124",
  headers: { "X-Custom-Header": "value" },
  timeout: 30,
  proxy: "http://localhost:3128",
});

const r = await session.get("/endpoint");
await session.close();
```

### Request Options

| Option | Type | Description |
|--------|------|-------------|
| `params` | `object` | URL query parameters |
| `headers` | `object` | Request headers |
| `cookies` | `object` | Request cookies |
| `data` | `object \| string` | Form data (application/x-www-form-urlencoded) |
| `json` | `any` | JSON body (automatically sets Content-Type) |
| `content` | `string \| Buffer` | Raw body content |
| `auth` | `object` | HTTP authentication (basic, digest, bearer) |
| `proxy` | `string` | Proxy URL |
| `timeout` | `number` | Request timeout in seconds |
| `connectTimeout` | `number` | Connection timeout in seconds |
| `allowRedirects` | `boolean` | Follow redirects (default: true) |
| `maxRedirects` | `number` | Maximum redirects (default: 30) |
| `verify` | `boolean` | Verify SSL certificates (default: true) |
| `impersonate` | `string` | Browser to impersonate |
| `ja3` | `string` | JA3 TLS fingerprint string |
| `akamai` | `string` | Akamai HTTP/2 fingerprint string |
| `extraFp` | `ExtraFingerprint` | Fine-grained fingerprint options |
| `httpVersion` | `string` | Force HTTP version ("1.0", "1.1", "2", "3") |

### Response Object

```typescript
import * as impers from "impers";

const r = await impers.get(url);

r.status;       // HTTP status code
r.statusText;   // HTTP status text
r.headers;      // Response headers
r.cookies;      // Response cookies
r.url;          // Final URL (after redirects)
r.text;         // Response body as string
r.content;      // Response body as Buffer
r.json();       // Parse response as JSON
r.elapsed;      // Request duration in seconds
```

## Acknowledgement

- TypeScript port inspired by [curl_cffi](https://github.com/lexiforest/curl_cffi).
- FFI bindings powered by [Koffi](https://koffi.dev/).
- Browser impersonation powered by [curl-impersonate](https://github.com/lexiforest/curl-impersonate).

## License

MIT
