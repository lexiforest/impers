/**
 * Mock HTTP server for testing
 * Mimics httpbin.org endpoints
 */
import Fastify, { type FastifyInstance } from "fastify";

let server: FastifyInstance | null = null;
let serverPort = 0;

export async function startMockServer(port = 0): Promise<number> {
  server = Fastify();

  // GET endpoint - returns request info
  server.get("/get", async (request, reply) => {
    return {
      args: request.query,
      headers: request.headers,
      origin: request.ip,
      url: `http://${request.headers.host}${request.url}`,
    };
  });

  // POST endpoint - returns request info with body
  server.post("/post", async (request, reply) => {
    let data = "";
    let json = null;
    let form: Record<string, string> = {};

    const contentType = request.headers["content-type"] || "";

    if (contentType.includes("application/json")) {
      json = request.body;
      data = JSON.stringify(request.body);
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      form = request.body as Record<string, string>;
    } else {
      data = String(request.body || "");
    }

    return {
      args: request.query,
      data,
      files: {},
      form,
      headers: request.headers,
      json,
      origin: request.ip,
      url: `http://${request.headers.host}${request.url}`,
    };
  });

  // PUT endpoint
  server.put("/put", async (request, reply) => {
    return {
      args: request.query,
      data: typeof request.body === "string" ? request.body : JSON.stringify(request.body),
      headers: request.headers,
      json: typeof request.body === "object" ? request.body : null,
      origin: request.ip,
      url: `http://${request.headers.host}${request.url}`,
    };
  });

  // DELETE endpoint
  server.delete("/delete", async (request, reply) => {
    return {
      args: request.query,
      headers: request.headers,
      origin: request.ip,
      url: `http://${request.headers.host}${request.url}`,
    };
  });

  // PATCH endpoint
  server.patch("/patch", async (request, reply) => {
    return {
      args: request.query,
      data: typeof request.body === "string" ? request.body : JSON.stringify(request.body),
      headers: request.headers,
      json: typeof request.body === "object" ? request.body : null,
      origin: request.ip,
      url: `http://${request.headers.host}${request.url}`,
    };
  });

  // Headers endpoint - returns only headers
  server.get("/headers", async (request, reply) => {
    return {
      headers: request.headers,
    };
  });

  // Status endpoint - returns specific status code
  server.get<{ Params: { code: string } }>("/status/:code", async (request, reply) => {
    const code = parseInt(request.params.code, 10);
    reply.code(code);
    return "";
  });

  // Delay endpoint - delays response
  server.get<{ Params: { seconds: string } }>("/delay/:seconds", async (request, reply) => {
    const seconds = parseFloat(request.params.seconds);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return {
      args: request.query,
      headers: request.headers,
      origin: request.ip,
      url: `http://${request.headers.host}${request.url}`,
    };
  });

  // Redirect endpoint - redirects n times
  server.get<{ Params: { n: string } }>("/redirect/:n", async (request, reply) => {
    const n = parseInt(request.params.n, 10);
    if (n > 1) {
      reply.redirect(`/redirect/${n - 1}`);
    } else {
      reply.redirect("/get");
    }
  });

  // Redirect endpoint that sets a cookie at each hop
  server.get<{ Params: { n: string } }>("/redirect-with-cookie/:n", async (request, reply) => {
    const n = parseInt(request.params.n, 10);
    reply.setCookie(`hop_${n}`, `value_${n}`, { path: "/" });
    if (n > 0) {
      reply.redirect(`/redirect-with-cookie/${n - 1}`);
    } else {
      reply.redirect("/cookies");
    }
  });

  // Absolute redirect endpoint
  server.get<{ Params: { n: string } }>("/absolute-redirect/:n", async (request, reply) => {
    const n = parseInt(request.params.n, 10);
    const host = request.headers.host;
    if (n > 1) {
      reply.redirect(`http://${host}/absolute-redirect/${n - 1}`);
    } else {
      reply.redirect(`http://${host}/get`);
    }
  });

  // Cookies endpoint - sets cookies
  server.get("/cookies/set", async (request, reply) => {
    const query = request.query as Record<string, string>;
    for (const [name, value] of Object.entries(query)) {
      reply.setCookie(name, value, { path: "/" });
    }
    return {
      cookies: query,
    };
  });

  // Cookies endpoint - returns cookies
  server.get("/cookies", async (request, reply) => {
    return {
      cookies: request.cookies || {},
    };
  });

  // Bytes endpoint - returns n random bytes
  server.get<{ Params: { n: string } }>("/bytes/:n", async (request, reply) => {
    const n = parseInt(request.params.n, 10);
    const bytes = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    reply.header("content-type", "application/octet-stream");
    return bytes;
  });

  // Stream endpoint - streams n lines
  server.get<{ Params: { n: string } }>("/stream/:n", async (request, reply) => {
    const n = parseInt(request.params.n, 10);
    reply.header("content-type", "application/json");

    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      lines.push(JSON.stringify({ id: i, url: `http://${request.headers.host}${request.url}` }));
    }
    return lines.join("\n");
  });

  // Anything endpoint - accepts any method and returns details
  server.all("/anything", async (request, reply) => {
    return {
      method: request.method,
      args: request.query,
      data: typeof request.body === "string" ? request.body : JSON.stringify(request.body || ""),
      headers: request.headers,
      json: typeof request.body === "object" ? request.body : null,
      origin: request.ip,
      url: `http://${request.headers.host}${request.url}`,
    };
  });

  // Basic auth endpoint
  server.get<{ Params: { user: string; passwd: string } }>("/basic-auth/:user/:passwd", async (request, reply) => {
    const { user, passwd } = request.params;
    const authHeader = request.headers.authorization || "";

    if (authHeader.startsWith("Basic ")) {
      const credentials = Buffer.from(authHeader.slice(6), "base64").toString();
      const [authUser, authPasswd] = credentials.split(":");
      if (authUser === user && authPasswd === passwd) {
        return { authenticated: true, user };
      }
    }

    reply.code(401);
    reply.header("WWW-Authenticate", 'Basic realm="Fake Realm"');
    return { authenticated: false };
  });

  // Register plugins for cookies, body parsing, and WebSocket
  await server.register(import("@fastify/cookie"));
  await server.register(import("@fastify/formbody"));
  await server.register(import("@fastify/websocket"));

  // WebSocket echo endpoint
  server.get("/ws/echo", { websocket: true }, (socket) => {
    socket.on("message", (message: Buffer, isBinary: boolean) => {
      // Echo back the message preserving binary/text frame type
      socket.send(message, { binary: isBinary });
    });
  });

  // WebSocket endpoint that sends messages
  server.get("/ws/push", { websocket: true }, (socket) => {
    let count = 0;
    const interval = setInterval(() => {
      if (socket.readyState === 1) { // OPEN
        socket.send(JSON.stringify({ count: ++count, timestamp: Date.now() }));
      }
      if (count >= 5) {
        clearInterval(interval);
        socket.close(1000, "Done");
      }
    }, 100);

    socket.on("close", () => {
      clearInterval(interval);
    });
  });

  // WebSocket ping/pong test
  server.get("/ws/ping", { websocket: true }, (socket) => {
    socket.on("message", (message: Buffer) => {
      const text = message.toString();
      if (text === "ping") {
        socket.send("pong");
      }
    });
  });

  const address = await server.listen({ port, host: "127.0.0.1" });
  serverPort = parseInt(address.split(":").pop() || "0", 10);
  return serverPort;
}

export async function stopMockServer(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    serverPort = 0;
  }
}

export function getServerUrl(): string {
  if (serverPort === 0) {
    throw new Error("Mock server not started");
  }
  return `http://127.0.0.1:${serverPort}`;
}

export function getServerPort(): number {
  return serverPort;
}

export function getWebSocketUrl(): string {
  if (serverPort === 0) {
    throw new Error("Mock server not started");
  }
  return `ws://127.0.0.1:${serverPort}`;
}
