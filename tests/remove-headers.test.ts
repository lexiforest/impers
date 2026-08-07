/**
 * A caller must be able to drop a header libcurl would otherwise invent.
 *
 * The visible case is `Content-Type: application/x-www-form-urlencoded`, which libcurl adds
 * to any POST carrying fields — including an empty one. `headers` cannot express removal:
 * an empty value there is serialised as `Name;`, curl's "send this header empty", which is
 * a different request from not sending it.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Session } from "../src/http/session.js";

let server: Server;
let port: number;
let seen: Record<string, string | string[] | undefined> = {};

beforeAll(async () => {
  server = createServer((request, response) => {
    seen = request.headers;
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("removeHeaders", () => {
  it("drops a header libcurl would have generated", async () => {
    const session = new Session({ timeout: 10 });
    await session.request("POST", `http://127.0.0.1:${port}/`, {
      content: "",
      removeHeaders: ["content-type"],
    });
    expect(seen["content-type"]).toBeUndefined();
    // Removing it must not turn the request into one with no body length.
    expect(seen["content-length"]).toBe("0");
  });

  it("leaves the header alone when not asked to remove it", async () => {
    const session = new Session({ timeout: 10 });
    await session.request("POST", `http://127.0.0.1:${port}/`, { content: "" });
    expect(seen["content-type"]).toBe("application/x-www-form-urlencoded");
  });
});
