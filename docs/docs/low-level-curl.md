---
title: Low-level Curl API
sidebar_label: Low-level Curl
---

# Low-level Curl API

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

The exported constants follow curl-impersonate 2.3.1 / curl 8.23.0, including
`CurlOpt.QUIC_INITIAL_PACKET_NUMBER`, `CurlOpt.HTTPSIG_*`, and `CurlWsOpt`.
HTTP Message Signature authentication and algorithms are available through
`constants.CurlAuth.CURLAUTH_HTTPSIG` and `constants.CurlHttpSig`.
The obsolete TLS-SRP options (`TLSAUTH_*` and `PROXY_TLSAUTH_*`) were removed
from upstream curl and are no longer exported in `CurlOpt`.

To regenerate `CurlOpt` and `CurlInfo` from a local patched build:

```sh
CURL_HEADER_PATH=../curl-impersonate/build/deps/src/curl/include/curl/curl.h npm run gen:ffi-consts
```
