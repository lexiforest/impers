/**
 * A header given several values must be sent with all of them.
 *
 * `HeadersInit` accepts `Record<string, string | string[]>` and repeated `[name, value]`
 * pairs, and `Headers` stores every value — but request headers were applied to the outgoing
 * list with `set()` per entry, so each value replaced the one before it and only the last
 * reached the wire. The visible case is `Cookie`, which HTTP/2 senders split into one field
 * per cookie (RFC 7540 8.1.2.5) so each compresses independently in HPACK.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Session } from "../src/http/session.js";

let server: Server;
let port: number;
let seen: string[] = [];

/** `request.headers` joins repeated names; only the raw list shows how many were sent. */
function fieldsNamed(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < seen.length; index += 2) {
    if (seen[index].toLowerCase() === name) values.push(seen[index + 1]);
  }
  return values;
}

function namesInOrder(): string[] {
  const names: string[] = [];
  for (let index = 0; index < seen.length; index += 2) names.push(seen[index].toLowerCase());
  return names;
}

beforeAll(async () => {
  server = createServer((request, response) => {
    seen = request.rawHeaders;
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("a request header with several values", () => {
  it("sends every value, in order", async () => {
    const session = new Session({ timeout: 10 });
    await session.request("GET", `http://127.0.0.1:${port}/`, {
      headers: { cookie: ["a=1", "b=2", "c=3"] },
    });
    expect(fieldsNamed("cookie")).toEqual(["a=1", "b=2", "c=3"]);
  });

  it("sends every value given as repeated pairs", async () => {
    const session = new Session({ timeout: 10 });
    await session.request("GET", `http://127.0.0.1:${port}/`, {
      headers: [
        ["cookie", "a=1"],
        ["cookie", "b=2"],
      ],
    });
    expect(fieldsNamed("cookie")).toEqual(["a=1", "b=2"]);
  });

  it("replaces the session's value and keeps the header's position", async () => {
    const session = new Session({
      timeout: 10,
      headers: { "x-before": "1", cookie: "from-session=1", "x-after": "2" },
    });
    await session.request("GET", `http://127.0.0.1:${port}/`, {
      headers: { cookie: ["a=1", "b=2"] },
    });
    expect(fieldsNamed("cookie")).toEqual(["a=1", "b=2"]);
    // A caller reproducing a browser's header order depends on an overridden header
    // staying where it was, rather than moving to the end of the list.
    const names = namesInOrder();
    expect(names.indexOf("x-before")).toBeLessThan(names.indexOf("cookie"));
    expect(names.lastIndexOf("cookie")).toBeLessThan(names.indexOf("x-after"));
  });
});
