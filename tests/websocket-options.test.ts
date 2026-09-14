/**
 * The WebSocket handshake must actually carry the options the caller passed.
 *
 * These were accepted and silently dropped: `headers` was built into a curl header list
 * and then discarded ("Note: Would need SList here"), and `cookies`, `impersonate`,
 * `proxy` and `verify` were never read at all. A caller talking to a real server — one
 * that needs a session cookie, or that fingerprints the TLS handshake — got a connection
 * that looked nothing like what they asked for, with no error to say so.
 *
 * The assertions are made against a server that records the upgrade request, because the
 * only place the difference is observable is on the wire.
 */
import { wsConnect } from "../src/websocket/websocket.js";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

interface SeenRequest {
  headers: Record<string, string | string[] | undefined>;
  order: string[];
}

let server: Server;
const upgraded: Array<{ destroy(): void }> = [];
let port: number;
let seen: SeenRequest | null;

beforeAll(async () => {
  server = createServer();
  server.on("upgrade", (request, socket) => {
    upgraded.push(socket);
    seen = {
      headers: request.headers,
      order: request.rawHeaders.filter((_, index) => index % 2 === 0),
    };
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  // This server answers the handshake and nothing else — it never processes a close frame,
  // so the upgraded sockets stay open and `close()` alone would wait for them forever.
  for (const socket of upgraded) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = null;
});

describe("WebSocket handshake options", () => {
  it("sends the caller's headers", async () => {
    const ws = await wsConnect(`ws://127.0.0.1:${port}/`, {
      headers: {
        Origin: "app://-",
        "User-Agent": "test-agent/1.0",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    expect(seen?.headers["origin"]).toBe("app://-");
    expect(seen?.headers["user-agent"]).toBe("test-agent/1.0");
    expect(seen?.headers["accept-language"]).toBe("en-US,en;q=0.9");

    await ws.close();
  });

  it("sends the caller's cookies", async () => {
    const ws = await wsConnect(`ws://127.0.0.1:${port}/`, {
      cookies: { session: "abc123", other: "def456" },
    });

    expect(seen?.headers["cookie"]).toContain("session=abc123");
    expect(seen?.headers["cookie"]).toContain("other=def456");

    await ws.close();
  });

  it("still completes the handshake when impersonating", async () => {
    const ws = await wsConnect(`ws://127.0.0.1:${port}/`, {
      impersonate: "chrome",
      defaultHeaders: false,
      headers: { Origin: "app://-" },
    });

    // The TLS fingerprint is not observable over a plaintext socket; what is checked here
    // is that impersonation is applied without discarding the caller's headers, which is
    // the ordering mistake this is easy to make.
    expect(seen?.headers["origin"]).toBe("app://-");

    await ws.close();
  });

  it("rejects an impersonation target that does not exist", async () => {
    await expect(
      wsConnect(`ws://127.0.0.1:${port}/`, { impersonate: "not-a-browser" })
    ).rejects.toThrow(/not supported/);
  });
});
