/**
 * WebSocket tests
 */
import { AsyncWebSocket, wsConnect } from "../src/websocket/websocket.js";
import { WebSocketError, WebSocketClosed } from "../src/utils/errors.js";
import { getWebSocketUrl } from "./mock-server.js";

describe("AsyncWebSocket", () => {
  let wsUrl: string;

  beforeAll(() => {
    wsUrl = getWebSocketUrl();
  });

  describe("connection", () => {
    it("should connect to WebSocket server", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/echo`);
      expect(ws.connected).toBe(true);
      expect(ws.closed).toBe(false);
      await ws.close();
    });

    it("should expose URL property", async () => {
      const url = `${wsUrl}/ws/echo`;
      const ws = await AsyncWebSocket.connect(url);
      expect(ws.url).toBe(url);
      await ws.close();
    });

    it("should fail to connect to invalid URL", async () => {
      await expect(
        AsyncWebSocket.connect("ws://127.0.0.1:1/invalid")
      ).rejects.toThrow(WebSocketError);
    });
  });

  describe("send and receive", () => {
    it("should send and receive text message", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/echo`);

      await ws.sendStr("Hello WebSocket!");
      const response = await ws.recvStr(5);

      expect(response).toBe("Hello WebSocket!");
      await ws.close();
    });

    it("should send and receive JSON", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/echo`);

      const obj = { foo: "bar", num: 42 };
      await ws.sendJson(obj);
      const response = await ws.recvJson(5);

      expect(response).toEqual(obj);
      await ws.close();
    });

    it("should receive multiple messages", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/push`);

      // The push endpoint sends 5 messages
      const messages: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const msg = await ws.recvJson(5);
        messages.push(msg);
      }

      expect(messages.length).toBe(5);
      expect((messages[0] as { count: number }).count).toBe(1);
      expect((messages[4] as { count: number }).count).toBe(5);

      await ws.close();
    });

    it("should timeout on receive", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/ping`);

      // Don't send anything, just try to receive with short timeout
      await expect(ws.recv(0.1)).rejects.toThrow("timeout");

      await ws.close();
    });
  });

  describe("ping/pong", () => {
    it("should respond to application-level ping", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/ping`);

      await ws.sendStr("ping");
      const response = await ws.recvStr(5);

      expect(response).toBe("pong");
      await ws.close();
    });
  });

  describe("close", () => {
    it("should close connection cleanly", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/echo`);

      await ws.close(1000, "Normal closure");

      expect(ws.closed).toBe(true);
      expect(ws.connected).toBe(false);
      expect(ws.closeEvent?.code).toBe(1000);
      expect(ws.closeEvent?.reason).toBe("Normal closure");
    });

    it("should throw when sending on closed connection", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/echo`);
      await ws.close();

      await expect(ws.sendStr("test")).rejects.toThrow(WebSocketClosed);
    });

    it("should throw when receiving on closed connection", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/echo`);
      await ws.close();

      await expect(ws.recv()).rejects.toThrow(WebSocketClosed);
    });
  });

  describe("async iterator", () => {
    it("should iterate over messages", async () => {
      const ws = await AsyncWebSocket.connect(`${wsUrl}/ws/push`);

      const messages: unknown[] = [];
      for await (const msg of ws) {
        messages.push(JSON.parse(msg.data.toString()));
        if (messages.length >= 3) {
          await ws.close();
          break;
        }
      }

      expect(messages.length).toBe(3);
    });
  });

  describe("wsConnect helper", () => {
    it("should connect using helper function", async () => {
      const ws = await wsConnect(`${wsUrl}/ws/echo`);
      expect(ws.connected).toBe(true);
      await ws.close();
    });
  });
});
