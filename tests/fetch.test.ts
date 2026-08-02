/**
 * Tests for the Fetch API compatible `fetch()` function
 */
import { fetch, type ImpersRequestInit } from "../src/http/fetch.js";

describe("fetch()", () => {
  describe("GET requests", () => {
    it("should make a basic GET request and return a global Response", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`);
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
      const json = (await res.json()) as { url: string };
      expect(json.url).toContain("/get");
    });

    it("should read text body", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
      expect(JSON.parse(text).url).toContain("/get");
    });

    it("should read arrayBuffer body", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/bytes/16`);
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBe(16);
    });

    it("should expose response headers", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`);
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("should support URL input", async () => {
      const res = await fetch(new URL(`${globalThis.TEST_SERVER_URL}/get`));
      expect(res.status).toBe(200);
    });

    it("should preserve GET for a bodyless Request input", async () => {
      const req = new Request(`${globalThis.TEST_SERVER_URL}/anything`);
      const res = await fetch(req);
      const json = (await res.json()) as { method: string };
      expect(json.method).toBe("GET");
    });

    it("should send custom headers", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/headers`, {
        headers: { "X-Custom-Header": "fetch-value" },
      });
      const json = (await res.json()) as { headers: Record<string, string> };
      expect(json.headers["x-custom-header"]).toBe("fetch-value");
    });

    it("should send query params via impers extension", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`, {
        params: { foo: "bar", num: 123 },
      });
      const json = (await res.json()) as { args: Record<string, string> };
      expect(json.args.foo).toBe("bar");
      expect(json.args.num).toBe("123");
    });
  });

  describe("POST requests", () => {
    it("should send a string body", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: "hello-body",
      });
      const json = (await res.json()) as { data: string; headers: Record<string, string> };
      expect(json.data).toBe("hello-body");
      expect(json.headers["content-type"]).toBe("text/plain;charset=UTF-8");
    });

    it("should send a JSON body via string", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: JSON.stringify({ message: "hi", count: 7 }),
        headers: { "Content-Type": "application/json" },
      });
      const json = (await res.json()) as { json: { message: string; count: number } };
      expect(json.json).toEqual({ message: "hi", count: 7 });
    });

    it("should send a URLSearchParams body", async () => {
      const params = new URLSearchParams();
      params.append("username", "test");
      params.append("password", "secret");
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: params,
      });
      const json = (await res.json()) as {
        form: Record<string, string>;
        headers: Record<string, string>;
      };
      expect(json.form.username).toBe("test");
      expect(json.form.password).toBe("secret");
      expect(json.headers["content-type"]).toBe(
        "application/x-www-form-urlencoded;charset=UTF-8",
      );
    });

    it("should send an ArrayBuffer/Uint8Array body", async () => {
      const data = new Uint8Array([72, 105, 33]); // "Hi!"
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: data,
        headers: { "Content-Type": "text/plain" },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { data: string };
      expect(json.data).toBe("Hi!");
    });

    it("should send a Blob body", async () => {
      const blob = new Blob(["blob-content"], { type: "text/plain" });
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: blob,
      });
      const json = (await res.json()) as { data: string; headers: Record<string, string> };
      expect(json.data).toBe("blob-content");
      expect(json.headers["content-type"]).toBe("text/plain");
    });

    it("should send a FormData body", async () => {
      const form = new FormData();
      form.append("title", "hello");
      form.append("file", new Blob(["file-contents"], { type: "text/plain" }), "note.txt");
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as {
        form: Record<string, string>;
        files: Record<string, { filename: string; contentType: string; data: string; size: number }>;
        headers: Record<string, string>;
      };
      expect(json.form.title).toBe("hello");
      expect(json.files.file.filename).toBe("note.txt");
      expect(json.files.file.data).toBe("file-contents");
      expect(json.headers["content-type"]).toContain("multipart/form-data");
    });
  });

  describe("Request input", () => {
    it("should inherit method/headers/body from a Request", async () => {
      const req = new Request(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        headers: { "X-Inherited": "yes", "Content-Type": "text/plain" },
        body: "from-request",
      });
      const res = await fetch(req);
      const json = (await res.json()) as { data: string; headers: Record<string, string> };
      expect(json.data).toBe("from-request");
      expect(json.headers["x-inherited"]).toBe("yes");
    });

    it("should allow init to override Request fields", async () => {
      const req = new Request(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: "original",
        headers: { "Content-Type": "text/plain" },
      });
      const res = await fetch(req, { body: "overridden" });
      const json = (await res.json()) as { data: string };
      expect(json.data).toBe("overridden");
    });

    it("should reject a consumed Request without a replacement body", async () => {
      const req = new Request(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: "consumed",
      });
      await req.text();
      await expect(fetch(req)).rejects.toBeInstanceOf(TypeError);
    });

    it("should allow a consumed Request with a replacement body", async () => {
      const req = new Request(`${globalThis.TEST_SERVER_URL}/post`, {
        method: "POST",
        body: "consumed",
      });
      await req.text();
      const res = await fetch(req, { body: "replacement" });
      const json = (await res.json()) as { data: string };
      expect(json.data).toBe("replacement");
    });
  });

  describe("Redirects", () => {
    it("should follow redirects by default (follow)", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/redirect/2`);
      expect(res.status).toBe(200);
    });

    it("should return the 3xx response for redirect: manual", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/redirect/2`, {
        redirect: "manual",
      });
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
    });

    it("should throw TypeError for redirect: error", async () => {
      await expect(
        fetch(`${globalThis.TEST_SERVER_URL}/redirect/2`, { redirect: "error" }),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it("should not throw for non-redirect responses with redirect: error", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`, {
        redirect: "error",
      });
      expect(res.status).toBe(200);
    });

    it("should default maxRedirects to 20", async () => {
      // redirect/21 produces 21 hops then lands on /get; within default limit of 20.
      // Use a chain small enough to verify follow works; 20-limit verified by
      // expecting failure when exceeding it.
      await expect(
        fetch(`${globalThis.TEST_SERVER_URL}/redirect/25`),
      ).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe("Error handling", () => {
    it("should reject with TypeError on connection failure", async () => {
      await expect(fetch("http://127.0.0.1:1/nope")).rejects.toBeInstanceOf(TypeError);
    });

    it("should reject with TypeError on abort", async () => {
      const controller = new AbortController();
      const promise = fetch(`${globalThis.TEST_SERVER_URL}/delay/2`, {
        signal: controller.signal,
      });
      setTimeout(() => controller.abort("cancelled"), 50);
      await expect(promise).rejects.toBeInstanceOf(TypeError);
    });

    it("should preserve the original error in cause", async () => {
      try {
        await fetch("http://127.0.0.1:1/nope");
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TypeError);
        expect((err as TypeError).cause).toBeDefined();
      }
    });

    it("should not reject on 4xx/5xx (returns ok=false)", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/status/404`);
      expect(res.status).toBe(404);
      expect(res.ok).toBe(false);
    });

    it("should not reject on 500", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/status/500`);
      expect(res.status).toBe(500);
      expect(res.ok).toBe(false);
    });
  });

  describe("Body semantics", () => {
    it.each([204, 205, 304])("should return a null body for status %i", async (status) => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/status/${status}`);
      expect(res.status).toBe(status);
      expect(res.body).toBeNull();
    });

    it("should return a null body for HEAD responses", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`, { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    });

    it("should mark bodyUsed true after text()", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`);
      await res.text();
      expect(res.bodyUsed).toBe(true);
    });

    it("should throw when reading body twice", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`);
      await res.text();
      await expect(res.text()).rejects.toThrow();
    });

    it("should allow clone() to read body twice", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`);
      const clone = res.clone();
      const a = await res.text();
      const b = await clone.text();
      expect(a).toBe(b);
    });
  });

  describe("impers extensions", () => {
    it("should accept impersonate option without error", async () => {
      const init: ImpersRequestInit = { impersonate: "chrome124" };
      // Mock server ignores impersonation; verify it doesn't throw and returns 200.
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`, init);
      expect(res.status).toBe(200);
    });

    it("should ignore unsupported standard fields (credentials/mode)", async () => {
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/get`, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        credentials: "include" as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mode: "cors" as any,
        integrity: "sha256-abc",
        keepalive: true,
      });
      expect(res.status).toBe(200);
    });

    it("should not persist cookies between fetch() calls", async () => {
      // Set a cookie via the server, then make a second request to /cookies.
      // If fetch() shared state, the cookie would be sent back; since each
      // fetch() uses a fresh Session, the cookie jar must be empty.
      await fetch(`${globalThis.TEST_SERVER_URL}/cookies/set?marker=1`);
      const res = await fetch(`${globalThis.TEST_SERVER_URL}/cookies`);
      const json = (await res.json()) as { cookies: Record<string, string> };
      expect(Object.keys(json.cookies).length).toBe(0);
    });
  });
});
