/**
 * Tests for HTTP requests using Session class
 */
import { Session } from "../src/http/session.js";
import { Headers } from "../src/http/headers.js";
import { get, post, put, del, patch } from "../src/public.js";

describe("Session", () => {
  let session: Session;

  beforeEach(() => {
    session = new Session({
      timeout: 10,
    });
  });

  afterEach(async () => {
    await session.close();
  });

  describe("GET requests", () => {
    it("should make basic GET request", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/get`);
      expect(resp.statusCode).toBe(200);
      expect(resp.ok).toBe(true);
    });

    it("should include query parameters", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/get`, {
        params: { foo: "bar", num: 123 },
      });
      const json = resp.json() as { args: Record<string, string> };
      expect(json.args.foo).toBe("bar");
      expect(json.args.num).toBe("123");
    });

    it("should include custom headers", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/headers`, {
        headers: { "X-Custom-Header": "test-value" },
      });
      const json = resp.json() as { headers: Record<string, string> };
      expect(json.headers["x-custom-header"]).toBe("test-value");
    });
  });

  describe("POST requests", () => {
    it("should send JSON body", async () => {
      const resp = await session.post(`${globalThis.TEST_SERVER_URL}/post`, {
        json: { message: "hello", count: 42 },
      });
      expect(resp.statusCode).toBe(200);
      const json = resp.json() as { json: { message: string; count: number } };
      expect(json.json).toEqual({ message: "hello", count: 42 });
    });

    it("should send form data", async () => {
      const resp = await session.post(`${globalThis.TEST_SERVER_URL}/post`, {
        data: { username: "test", password: "secret" },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const json = resp.json() as { form: Record<string, string> };
      expect(json.form.username).toBe("test");
      expect(json.form.password).toBe("secret");
    });
  });

  describe("PUT requests", () => {
    it("should make PUT request with JSON", async () => {
      const resp = await session.put(`${globalThis.TEST_SERVER_URL}/put`, {
        json: { id: 1, name: "updated" },
      });
      expect(resp.statusCode).toBe(200);
      const json = resp.json() as { json: { id: number; name: string } };
      expect(json.json).toEqual({ id: 1, name: "updated" });
    });
  });

  describe("DELETE requests", () => {
    it("should make DELETE request", async () => {
      const resp = await session.delete(`${globalThis.TEST_SERVER_URL}/delete`);
      expect(resp.statusCode).toBe(200);
    });
  });

  describe("PATCH requests", () => {
    it("should make PATCH request with JSON", async () => {
      const resp = await session.patch(`${globalThis.TEST_SERVER_URL}/patch`, {
        json: { field: "value" },
      });
      expect(resp.statusCode).toBe(200);
    });
  });

  describe("Response handling", () => {
    it("should parse JSON response", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/get`);
      const json = resp.json();
      expect(typeof json).toBe("object");
    });

    it("should get text response", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/get`);
      const text = resp.text;
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    });

    it("should get response headers", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/get`);
      expect(resp.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("Status codes", () => {
    it("should handle 200 OK", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/status/200`);
      expect(resp.statusCode).toBe(200);
      expect(resp.ok).toBe(true);
    });

    it("should handle 404 Not Found", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/status/404`);
      expect(resp.statusCode).toBe(404);
      expect(resp.ok).toBe(false);
    });

    it("should handle 500 Server Error", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/status/500`);
      expect(resp.statusCode).toBe(500);
      expect(resp.ok).toBe(false);
    });
  });

  describe("Redirects", () => {
    it("should follow redirects by default", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/redirect/2`);
      expect(resp.statusCode).toBe(200);
      // After following redirects, should get successful response
      const json = resp.json() as { args: Record<string, string> };
      expect(json).toBeDefined();
    });

    it("should not follow redirects when disabled", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/redirect/2`, {
        allowRedirects: false,
      });
      expect(resp.statusCode).toBe(302);
    });

    it("should respect maxRedirects", async () => {
      // Should fail if more redirects than allowed
      await expect(
        session.get(`${globalThis.TEST_SERVER_URL}/redirect/5`, {
          maxRedirects: 2,
        })
      ).rejects.toThrow();
    });

    it("should populate response.history for redirect chain", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/redirect/3`);
      expect(resp.statusCode).toBe(200);
      expect(resp.history.length).toBe(3);
      for (const hop of resp.history) {
        expect(hop.statusCode).toBe(302);
      }
    });

    it("should track URLs through the redirect chain", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/redirect/2`);
      expect(resp.history.length).toBe(2);
      expect(resp.history[0].requestUrl).toContain("/redirect/2");
      expect(resp.history[1].requestUrl).toContain("/redirect/1");
    });

    it("should have empty history when no redirects occur", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/get`);
      expect(resp.history).toEqual([]);
    });

    it("should have empty history when redirects are disabled", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/redirect/2`, {
        allowRedirects: false,
      });
      expect(resp.history).toEqual([]);
    });

    it("should extract cookies from intermediate redirect hops", async () => {
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/redirect-with-cookie/2`);
      expect(resp.statusCode).toBe(200);
      // Cookies set at hop 2, hop 1, and hop 0 should all be in the session
      expect(session.cookies.get("hop_2")).toBe("value_2");
      expect(session.cookies.get("hop_1")).toBe("value_1");
      expect(session.cookies.get("hop_0")).toBe("value_0");
    });

    it("should make accumulated redirect cookies available on subsequent requests", async () => {
      await session.get(`${globalThis.TEST_SERVER_URL}/redirect-with-cookie/2`);
      // Session now has cookies from all hops; a follow-up request should send them
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/cookies`);
      const json = resp.json() as { cookies: Record<string, string> };
      expect(json.cookies["hop_2"]).toBe("value_2");
      expect(json.cookies["hop_1"]).toBe("value_1");
      expect(json.cookies["hop_0"]).toBe("value_0");
    });
  });

  describe("Delays", () => {
    it("should handle delayed responses", async () => {
      const start = Date.now();
      const resp = await session.get(`${globalThis.TEST_SERVER_URL}/delay/1`);
      const elapsed = Date.now() - start;
      expect(resp.statusCode).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(900); // Allow some tolerance
    });
  });
});

describe("Headers.splitRawByResponse", () => {
  it("should split multi-response raw headers into segments", () => {
    const raw =
      "HTTP/1.1 302 Found\r\nLocation: /get\r\nSet-Cookie: a=1\r\n\r\n" +
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n";

    const segments = Headers.splitRawByResponse(raw);
    expect(segments.length).toBe(2);

    expect(segments[0].statusCode).toBe(302);
    expect(segments[0].statusText).toBe("Found");
    expect(segments[0].headers.get("location")).toBe("/get");
    expect(segments[0].headers.get("set-cookie")).toBe("a=1");

    expect(segments[1].statusCode).toBe(200);
    expect(segments[1].statusText).toBe("OK");
    expect(segments[1].headers.get("content-type")).toBe("application/json");
  });

  it("should return a single segment for non-redirect responses", () => {
    const raw = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n";
    const segments = Headers.splitRawByResponse(raw);
    expect(segments.length).toBe(1);
    expect(segments[0].statusCode).toBe(200);
  });
});

describe("Standalone functions", () => {
  it("get() should work", async () => {
    const resp = await get(`${globalThis.TEST_SERVER_URL}/get`);
    expect(resp.statusCode).toBe(200);
  });

  it("post() should work", async () => {
    const resp = await post(`${globalThis.TEST_SERVER_URL}/post`, {
      json: { test: true },
    });
    expect(resp.statusCode).toBe(200);
  });

  it("put() should work", async () => {
    const resp = await put(`${globalThis.TEST_SERVER_URL}/put`, {
      json: { test: true },
    });
    expect(resp.statusCode).toBe(200);
  });

  it("del() should work", async () => {
    const resp = await del(`${globalThis.TEST_SERVER_URL}/delete`);
    expect(resp.statusCode).toBe(200);
  });

  it("patch() should work", async () => {
    const resp = await patch(`${globalThis.TEST_SERVER_URL}/patch`, {
      json: { test: true },
    });
    expect(resp.statusCode).toBe(200);
  });
});

describe("Concurrent requests", () => {
  let session: Session;

  beforeEach(() => {
    session = new Session({ timeout: 10 });
  });

  afterEach(async () => {
    await session.close();
  });

  it("should handle multiple concurrent requests", async () => {
    const urls = [
      `${globalThis.TEST_SERVER_URL}/get?n=1`,
      `${globalThis.TEST_SERVER_URL}/get?n=2`,
      `${globalThis.TEST_SERVER_URL}/get?n=3`,
      `${globalThis.TEST_SERVER_URL}/get?n=4`,
      `${globalThis.TEST_SERVER_URL}/get?n=5`,
    ];

    const responses = await Promise.all(urls.map((url) => session.get(url)));

    expect(responses).toHaveLength(5);
    responses.forEach((resp) => {
      expect(resp.statusCode).toBe(200);
    });
  });

  it("should complete concurrent delayed requests faster than sequential", async () => {
    const start = Date.now();

    const responses = await Promise.all([
      session.get(`${globalThis.TEST_SERVER_URL}/delay/1`),
      session.get(`${globalThis.TEST_SERVER_URL}/delay/1`),
    ]);

    const elapsed = Date.now() - start;

    expect(responses).toHaveLength(2);
    // Should complete in ~1 second (concurrent), not ~2 seconds (sequential)
    expect(elapsed).toBeLessThan(2500);
  });
});
