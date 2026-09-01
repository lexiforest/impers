/**
 * A pong must go out as a pong.
 *
 * `CURLWS_PONG` and `CURLWS_OFFSET` were defined the wrong way round: libcurl's
 * websockets.h has `CURLWS_OFFSET` at `1<<5` and `CURLWS_PONG` at `1<<6`. Sending a pong
 * therefore asked libcurl for an offset-send with no frame type, which it rejected with
 * `CURLE_BAD_FUNCTION_ARGUMENT` — so `pong()` never put a frame on the wire, and it failed
 * quietly for anyone who did not check. In the other direction a received pong carried
 * `1<<6`, matched none of the branches, and fell through to the BINARY default.
 *
 * The assertion is made on the raw opcode a server observes, because the constant being
 * wrong is invisible from every other vantage point.
 */
import { wsConnect } from "../src/websocket/websocket.js";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

const OPCODE_PONG = 0xa;

let server: Server;
let port: number;
const upgraded: Array<{ destroy(): void }> = [];
let clientOpcodes: number[] = [];

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
    socket.on("data", (chunk: Buffer) => clientOpcodes.push(chunk[0]! & 0x0f));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of upgraded) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  clientOpcodes = [];
});

describe("pong()", () => {
  it("puts a pong frame on the wire", async () => {
    const ws = await wsConnect(`ws://127.0.0.1:${port}/`);
    await ws.pong();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(clientOpcodes).toContain(OPCODE_PONG);
    await ws.close();
  });

  it("carries a payload", async () => {
    const ws = await wsConnect(`ws://127.0.0.1:${port}/`);
    // Before the fix this rejected with "Send failed with code 43".
    await expect(ws.pong(Buffer.from("keepalive"))).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(clientOpcodes).toContain(OPCODE_PONG);
    await ws.close();
  });
});
