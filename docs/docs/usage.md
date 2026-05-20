---
title: Usage
sidebar_label: Usage
---

# Usage

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

// To impersonate other than browsers, bring your own JA3/Akamai strings.
// See the examples directory for details.
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

## Request Bodies

Use `json` for JSON payloads and `data` for `application/x-www-form-urlencoded`
form payloads.

```typescript
await impers.post("https://httpbin.org/post", {
  json: { message: "hello" },
});

await impers.post("https://httpbin.org/post", {
  data: { username: "test", password: "secret" },
});
```

Use `multipart` when you need explicit multipart parts, including filenames and
content types. `impers` uses libcurl's MIME API and lets libcurl generate the
`Content-Type: multipart/form-data` boundary.

```typescript
await impers.post("https://httpbin.org/post", {
  multipart: [
    { name: "title", value: "Quarterly report" },
    {
      name: "attachment",
      value: Buffer.from("file contents"),
      filename: "report.txt",
      contentType: "text/plain",
    },
  ],
});
```

For the common file upload shape, use `files`. A string value is treated as a
local file path, a `Buffer` is uploaded with the field name as the filename, and
an object lets you set the filename and content type.

```typescript
await impers.post("https://httpbin.org/post", {
  data: { user: "alice" },
  files: {
    avatar: {
      filename: "avatar.txt",
      content: Buffer.from("avatar data"),
      contentType: "text/plain",
    },
    screenshot: "/path/to/screenshot.png",
  },
});
```

Use `readCallback` when the request body should be supplied incrementally. The
callback receives the maximum number of bytes libcurl can accept and should
return a `Buffer` or string. Return `null`, `undefined`, or an empty value to
signal end of input. Set `readCallbackSize` when the total byte size is known.

```typescript
const chunks = [Buffer.from("hello "), Buffer.from("world")];

await impers.post("https://httpbin.org/post", {
  headers: { "Content-Type": "text/plain" },
  readCallbackSize: chunks.reduce((total, chunk) => total + chunk.length, 0),
  readCallback: () => chunks.shift(),
});
```

## Streaming Callbacks

Use `contentCallback` to handle response body chunks as libcurl receives them.
Use `headerCallback` when you need raw response header chunks, for example when
proxying a response.

```typescript
await impers.get("https://example.com/data", {
  impersonate: "firefox",
  stream: true,
  headerCallback: (chunk) => {
    console.log(chunk.toString("latin1"));
  },
  contentCallback: (chunk) => {
    console.log(chunk);
  },
});
```
