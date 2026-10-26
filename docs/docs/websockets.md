---
title: WebSockets
sidebar_label: WebSockets
---

# WebSockets

```typescript
import * as impers from "impers";

const ws = await impers.wsConnect("wss://echo.websocket.org", {
  impersonate: "chrome124",
});

await ws.sendStr("Hello, World!");

for await (const message of ws) {
  console.log("Received:", message);
  if (message.type === "text" && message.data.toString() === "Hello, World!") {
    break;
  }
}

await ws.close();
```

## Compression

Set `perMessageDeflate: true` to negotiate WebSocket compression with
curl-impersonate 2.3.0 or later built with zlib:

```typescript
const ws = await impers.wsConnect("wss://example.com/socket", {
  perMessageDeflate: true,
});

try {
  await ws.sendStr("Hello, World!");
  console.log(await ws.recvStr(5));
} finally {
  await ws.close();
}
```

Compression is off by default. Text and binary messages are compressed only
when the server accepts the extension; otherwise they are sent uncompressed.
The application sends and receives ordinary uncompressed payloads. Ping, pong,
and close frames remain uncompressed.

The low-level equivalent is
`curl.setOpt(CurlOpt.WS_OPTIONS, CurlWsOpt.CURLWS_PERMESSAGE_DEFLATE)` before the
handshake. It cannot be combined with `CurlWsOpt.CURLWS_RAW_MODE`.
