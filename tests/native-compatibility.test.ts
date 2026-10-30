import { once } from "node:events";
import { WebSocketServer } from "ws";
import { Curl } from "../src/core/easy.js";
import { CurlCode, CurlInfo, CurlOpt, CurlWsOpt } from "../src/ffi/constants.js";
import { curl_easy_getinfo_slist, curl_slist_free_all, koffi } from "../src/ffi/libcurl.js";
import { NATIVE_IMPERSONATE_TARGETS } from "../src/fingerprints.js";
import { AsyncWebSocket, WebSocketMessageType } from "../src/websocket/websocket.js";

describe("curl-impersonate 2.3.2 compatibility", () => {
  it("reads native string, long, and list output parameters", () => {
    const curl = new Curl();
    try {
      curl.setOpt(CurlOpt.URL, "https://example.com/");
      expect(curl.getInfo(CurlInfo.EFFECTIVE_URL)).toBe("https://example.com/");
      expect(curl.getInfo(CurlInfo.RESPONSE_CODE)).toBe(0);
      const cookie = "example.com\tFALSE\t/\tFALSE\t0\tname\tvalue";
      curl.setOpt(CurlOpt.COOKIEFILE, "");
      curl.setOpt(CurlOpt.COOKIELIST, cookie);
      const { code, value } = curl_easy_getinfo_slist(curl.getHandle(), CurlInfo.COOKIELIST);
      try {
        expect(code).toBe(CurlCode.CURLE_OK);
        expect(value).not.toBeNull();
        expect(koffi.decode(value, "const char *")).toBe(cookie);
      } finally {
        curl_slist_free_all(value);
      }
    } finally {
      curl.cleanup();
    }
  });

  it.each(NATIVE_IMPERSONATE_TARGETS.map((target) => target.target_name))(
    "accepts the native profile %s",
    (target) => {
      const curl = new Curl();
      try {
        expect(() => curl.impersonate(target)).not.toThrow();
      } finally {
        curl.cleanup();
      }
    }
  );

  it("passes signed QUIC packet numbers as native longs and rejects out-of-range values", () => {
    const curl = new Curl();
    try {
      for (const value of [-1, 0, 1, 2147483647]) {
        expect(() => curl.setOpt(CurlOpt.QUIC_INITIAL_PACKET_NUMBER, value)).not.toThrow();
      }
      for (const value of [-2, 2147483648]) {
        // Windows longs are 32-bit, so Koffi can reject overflow before libcurl.
        expect(() => curl.setOpt(CurlOpt.QUIC_INITIAL_PACKET_NUMBER, value)).toThrow();
      }
    } finally {
      curl.cleanup();
    }
  });

  it("rejects WebSocket compression combined with raw mode", () => {
    const curl = new Curl();
    try {
      expect(() => curl.setOpt(
        CurlOpt.WS_OPTIONS,
        CurlWsOpt.CURLWS_PERMESSAGE_DEFLATE | CurlWsOpt.CURLWS_RAW_MODE
      )).toThrow(expect.objectContaining({ code: CurlCode.CURLE_BAD_FUNCTION_ARGUMENT }));
    } finally {
      curl.cleanup();
    }
  });

  it.each([
    { clientCompression: true, serverCompression: true, negotiated: true },
    { clientCompression: true, serverCompression: false, negotiated: false },
    { clientCompression: false, serverCompression: true, negotiated: false },
  ])("exchanges WebSocket messages with $clientCompression/$serverCompression compression", async ({
    clientCompression, serverCompression, negotiated,
  }) => {
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      perMessageDeflate: serverCompression,
    });
    let client: AsyncWebSocket | undefined;
    try {
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing WebSocket port");
      const connection = once(server, "connection");
      server.on("connection", (socket) => {
        socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
      });
      client = await AsyncWebSocket.connect(`ws://127.0.0.1:${address.port}`, {
        perMessageDeflate: clientCompression,
        headers: { "X-Impersonate-Test": "handshake" },
        timeout: 5,
      });
      const [socket, request] = await connection;
      expect(socket.extensions.includes("permessage-deflate")).toBe(negotiated);
      expect(request.headers["x-impersonate-test"]).toBe("handshake");

      const text = "compressible text ".repeat(100);
      await client.sendStr(text);
      expect(await client.recvStr(5)).toBe(text);

      const binary = Buffer.from([0, 1, 2, 127, 128, 255]);
      await client.send(binary);
      expect(await client.recv(5)).toEqual({ type: WebSocketMessageType.BINARY, data: binary });

      await client.ping("ping payload");
      expect(await client.recv(5)).toEqual({
        type: WebSocketMessageType.PONG,
        data: Buffer.from("ping payload"),
      });
    } finally {
      await client?.close();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
