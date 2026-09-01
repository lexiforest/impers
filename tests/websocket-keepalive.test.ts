/**
 * A server ping must be answered, without the caller doing anything.
 *
 * libcurl answers pings on its own, but it *queues* the pong and writes it only on the next
 * application send; receiving never flushes it. A consumer that only reads — the normal
 * shape for a subscription — therefore delivers no pong at all, and a server that enforces
 * a pong deadline closes the connection, with no error surfacing until the next receive.
 * Measured against one such server: an idle-but-reading client is dropped between 60 and 90
 * seconds.
 *
 * `CURLWS_NOAUTOPONG` moves the reply up here, where it goes out as an ordinary send.
 */
import { wsConnect } from "../src/websocket/websocket.js";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

/** A single unfragmented server frame; payloads here are well under 126 bytes. */
function frame(opcode: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}

interface ClientFrame {
  opcode: number;
  payload: string;
}

let server: Server;
let port: number;
const upgraded: Array<{ destroy(): void }> = [];
let received: ClientFrame[] = [];

/** Client frames are masked; unmask the payload so it can be compared. */
function readClientFrame(chunk: Buffer): ClientFrame {
  const length = chunk[1]! & 0x7f;
  const mask = chunk.subarray(2, 6);
  const masked = chunk.subarray(6, 6 + length);
  const payload = Buffer.from(masked.map((byte, index) => byte ^ mask[index % 4]!));
  return { opcode: chunk[0]! & 0x0f, payload: payload.toString("utf-8") };
}

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
    socket.on("data", (chunk: Buffer) => received.push(readClientFrame(chunk)));
    socket.write(frame(OPCODE_PING, Buffer.from("are-you-there")));
    socket.write(frame(0x1, Buffer.from("payload")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of upgraded) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
});

describe("server ping", () => {
  it("is answered with a pong echoing its payload, while only reading", async () => {
    const ws = await wsConnect(`ws://127.0.0.1:${port}/`);

    const message = await ws.recv(5);
    // The ping is answered, not delivered: libcurl absorbed pings entirely before, so the
    // message stream has never carried them.
    expect(message.type).toBe("text");
    expect(message.data.toString("utf-8")).toBe("payload");

    await new Promise((resolve) => setTimeout(resolve, 150));
    const pong = received.find((entry) => entry.opcode === OPCODE_PONG);
    expect(pong).toBeDefined();
    expect(pong?.payload).toBe("are-you-there");

    await ws.close();
  });
});
