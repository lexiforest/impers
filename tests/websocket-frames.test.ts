/**
 * Received frames must be reported with the type they actually had.
 *
 * `curl_ws_recv` returns its frame metadata through a `const struct curl_ws_frame **meta`
 * out-parameter. That parameter was declared to Koffi as a plain input `void **`, so the
 * pointer was never written back, `frame` was always null, and `frameToMessage` fell
 * through to its TEXT default for everything.
 *
 * The consequences were not cosmetic. A BINARY frame arrived as text. A CLOSE frame
 * arrived as a two-byte text message, so `closed` stayed false, `closeEvent` stayed null,
 * no close was echoed, and a consumer went on polling a dead socket forever — a
 * server-initiated close was, in effect, invisible.
 *
 * The frames here are hand-built rather than taken from a websocket library so that each
 * opcode is exercised exactly once, in a known order.
 */
import { wsConnect } from "../src/websocket/websocket.js";
import { WebSocketClosed } from "../src/utils/errors.js";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;

/** A single unfragmented server frame. Payloads here are always well under 126 bytes. */
function frame(opcode: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}

let server: Server;
const upgraded: Array<{ destroy(): void; write(data: Buffer | string): void }> = [];
let port: number;

beforeAll(async () => {
  server = createServer();
  server.on("upgrade", (request, socket) => {
    upgraded.push(socket);
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.write(frame(OPCODE_TEXT, Buffer.from("hello")));
    socket.write(frame(OPCODE_BINARY, Buffer.from([1, 2, 3])));
    socket.write(frame(OPCODE_CLOSE, Buffer.from([0x03, 0xe9]))); // 1001, Going Away
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of upgraded) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("received frame types", () => {
  it("distinguishes text, binary and close", async () => {
    const ws = await wsConnect(`ws://127.0.0.1:${port}/`);

    const text = await ws.recv(5);
    expect(text.type).toBe("text");
    expect(text.data.toString("utf-8")).toBe("hello");

    const binary = await ws.recv(5);
    expect(binary.type).toBe("binary");
    expect([...binary.data]).toEqual([1, 2, 3]);

    // Before the fix this resolved with a 2-byte "text" message and left the socket open.
    await expect(ws.recv(5)).rejects.toThrow(WebSocketClosed);
    expect(ws.closed).toBe(true);
    expect(ws.closeEvent?.code).toBe(1001);
  });
});
