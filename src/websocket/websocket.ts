/**
 * AsyncWebSocket - WebSocket client using libcurl
 *
 * Provides an async interface for WebSocket communication with support
 * for text, binary, ping/pong frames, and proper close handling.
 */

import { Curl } from "../core/easy.js";
import {
  curl_easy_perform_async,
  curl_ws_recv,
  curl_ws_send,
  type CurlHandle,
} from "../ffi/libcurl.js";
import { CurlOpt, CurlCode, CurlWsFlag } from "../ffi/constants.js";
import { WebSocketError, WebSocketClosed } from "../utils/errors.js";
import { Headers } from "../http/headers.js";
import type { WebSocketOptions } from "../types/options.js";

/**
 * WebSocket message types
 */
export enum WebSocketMessageType {
  TEXT = "text",
  BINARY = "binary",
  PING = "ping",
  PONG = "pong",
  CLOSE = "close",
}

/**
 * WebSocket message
 */
export interface WebSocketMessage {
  type: WebSocketMessageType;
  data: Buffer;
}

/**
 * WebSocket close event
 */
export interface WebSocketCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

// Re-export WebSocketOptions for convenience
export type { WebSocketOptions } from "../types/options.js";

/**
 * AsyncWebSocket - Async WebSocket client
 */
export class AsyncWebSocket {
  private curl: Curl;
  private handle: CurlHandle;

  private _url: string;
  private _connected: boolean = false;
  private _closed: boolean = false;
  private _closeEvent: WebSocketCloseEvent | null = null;

  private receiveBuffer: Buffer;
  private messageQueue: WebSocketMessage[] = [];

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollInterval: number = 10; // ms between polls

  private maxMessageSize: number;

  /**
   * Create a WebSocket connection
   * Use AsyncWebSocket.connect() for the preferred way to create a connection
   */
  private constructor(url: string, options: WebSocketOptions = {}) {
    this._url = url;
    this.maxMessageSize = options.maxMessageSize || 64 * 1024 * 1024; // 64MB default
    this.receiveBuffer = Buffer.alloc(Math.min(this.maxMessageSize, 1024 * 1024)); // Start with 1MB

    // Create curl handle
    this.curl = new Curl();
    this.handle = this.curl.getHandle()!;

    // Configure WebSocket URL (curl expects ws:// or wss:// scheme)
    this.curl.setOpt(CurlOpt.URL, url);

    // Enable WebSocket upgrade
    this.curl.setOpt(CurlOpt.CONNECT_ONLY, 2); // 2 = WebSocket mode

    // Set headers
    if (options.headers) {
      const headers = new Headers(options.headers);
      const headerList = headers.toCurlHeaders();
      // Note: Would need SList here for actual implementation
    }

    // Set timeout
    if (options.timeout) {
      this.curl.setOpt(CurlOpt.TIMEOUT, options.timeout);
    }
  }

  /**
   * Connect to a WebSocket server
   */
  static async connect(url: string, options: WebSocketOptions = {}): Promise<AsyncWebSocket> {
    const ws = new AsyncWebSocket(url, options);
    await ws.performConnect();
    return ws;
  }

  /**
   * Perform the WebSocket connection handshake using Koffi's async
   * worker thread to avoid blocking the Node.js event loop.
   */
  private async performConnect(): Promise<void> {
    try {
      const code = await curl_easy_perform_async(this.handle);
      if (code !== CurlCode.CURLE_OK) {
        throw new WebSocketError(`WS connect failed with code ${code}`);
      }
      this._connected = true;
    } catch (error) {
      this._closed = true;
      this.curl.cleanup();
      if (error instanceof WebSocketError) throw error;
      throw new WebSocketError(`Failed to connect: ${error}`);
    }
  }

  /**
   * Get the WebSocket URL
   */
  get url(): string {
    return this._url;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this._connected && !this._closed;
  }

  /**
   * Check if closed
   */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * Get close event details
   */
  get closeEvent(): WebSocketCloseEvent | null {
    return this._closeEvent;
  }

  /**
   * Try to receive a message (non-blocking)
   * Returns the message if available, null if CURLE_AGAIN
   * Throws on error
   */
  private tryReceive(): WebSocketMessage | null {
    if (this._closed) {
      return null;
    }

    const { code, received, frame } = curl_ws_recv(this.handle, this.receiveBuffer);

    if (code === CurlCode.CURLE_OK && received > 0) {
      // Process the received frame
      const data = Buffer.from(this.receiveBuffer.subarray(0, received));
      // Default to TEXT if no frame info available
      const flags = frame?.flags ?? CurlWsFlag.CURLWS_TEXT;
      const message = this.frameToMessage(data, flags);

      if (message) {
        // Handle close frame
        if (message.type === WebSocketMessageType.CLOSE) {
          this.handleCloseFrame(message.data);
          throw new WebSocketClosed(
            this._closeEvent?.code || 1000,
            this._closeEvent?.reason || ""
          );
        }

        // Handle ping - auto respond with pong
        if (message.type === WebSocketMessageType.PING) {
          this.sendPong(message.data).catch(() => {});
        }

        return message;
      }
    } else if (code === CurlCode.CURLE_AGAIN) {
      // No data available
      return null;
    } else if (code !== CurlCode.CURLE_OK) {
      // Error occurred
      throw new WebSocketError(`Receive error: ${code}`);
    }

    return null;
  }

  /**
   * Convert frame flags to message type
   */
  private frameToMessage(data: Buffer, flags: number): WebSocketMessage | null {
    if (flags & CurlWsFlag.CURLWS_TEXT) {
      return { type: WebSocketMessageType.TEXT, data };
    } else if (flags & CurlWsFlag.CURLWS_BINARY) {
      return { type: WebSocketMessageType.BINARY, data };
    } else if (flags & CurlWsFlag.CURLWS_PING) {
      return { type: WebSocketMessageType.PING, data };
    } else if (flags & CurlWsFlag.CURLWS_PONG) {
      return { type: WebSocketMessageType.PONG, data };
    } else if (flags & CurlWsFlag.CURLWS_CLOSE) {
      return { type: WebSocketMessageType.CLOSE, data };
    }
    // Default to binary
    return { type: WebSocketMessageType.BINARY, data };
  }

  /**
   * Handle close frame
   */
  private handleCloseFrame(data: Buffer): void {
    let code = 1000;
    let reason = "";

    if (data.length >= 2) {
      code = data.readUInt16BE(0);
      if (data.length > 2) {
        reason = data.subarray(2).toString("utf-8");
      }
    }

    this._closeEvent = { code, reason, wasClean: true };
    this._closed = true;
    this._connected = false;
  }

  /**
   * Receive a message with polling
   */
  async recv(timeout?: number): Promise<WebSocketMessage> {
    if (this._closed) {
      throw new WebSocketClosed(
        this._closeEvent?.code || 1006,
        this._closeEvent?.reason || "Connection closed"
      );
    }

    // Check queue first
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    const startTime = Date.now();
    const timeoutMs = timeout !== undefined ? timeout * 1000 : Infinity;

    // Poll for message
    return new Promise<WebSocketMessage>((resolve, reject) => {
      let settled = false;

      const poll = () => {
        if (settled) return;

        // Check timeout
        if (Date.now() - startTime >= timeoutMs) {
          settled = true;
          this.pollTimer = null;
          reject(new WebSocketError("Receive timeout"));
          return;
        }

        // Check if closed
        if (this._closed) {
          settled = true;
          this.pollTimer = null;
          reject(
            new WebSocketClosed(
              this._closeEvent?.code || 1006,
              this._closeEvent?.reason || "Connection closed"
            )
          );
          return;
        }

        try {
          const message = this.tryReceive();
          if (message) {
            settled = true;
            this.pollTimer = null;
            resolve(message);
            return;
          }

          // No message, schedule next poll (only if not closed/settled)
          if (!this._closed && !settled) {
            this.pollTimer = setTimeout(poll, this.pollInterval);
          }
        } catch (error) {
          settled = true;
          this.pollTimer = null;
          reject(error);
        }
      };

      // Start polling
      poll();
    });
  }

  /**
   * Receive a text message
   */
  async recvStr(timeout?: number): Promise<string> {
    const msg = await this.recv(timeout);
    return msg.data.toString("utf-8");
  }

  /**
   * Receive and parse as JSON
   */
  async recvJson<T = unknown>(timeout?: number): Promise<T> {
    const str = await this.recvStr(timeout);
    return JSON.parse(str) as T;
  }

  /**
   * Send raw data with flags
   */
  private async sendRaw(data: Buffer, flags: number): Promise<void> {
    if (this._closed) {
      throw new WebSocketClosed(
        this._closeEvent?.code || 1006,
        this._closeEvent?.reason || "Connection closed"
      );
    }

    const { code, sent } = curl_ws_send(this.handle, data, flags);

    if (code !== CurlCode.CURLE_OK) {
      throw new WebSocketError(`Send failed with code ${code}`);
    }

    if (sent !== data.length) {
      throw new WebSocketError(`Incomplete send: ${sent}/${data.length} bytes`);
    }
  }

  /**
   * Send binary data
   */
  async send(data: Buffer | Uint8Array): Promise<void> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await this.sendRaw(buffer, CurlWsFlag.CURLWS_BINARY);
  }

  /**
   * Send text message
   */
  async sendStr(text: string): Promise<void> {
    const buffer = Buffer.from(text, "utf-8");
    await this.sendRaw(buffer, CurlWsFlag.CURLWS_TEXT);
  }

  /**
   * Send binary data
   */
  async sendBinary(data: Buffer | Uint8Array): Promise<void> {
    await this.send(data);
  }

  /**
   * Send JSON message
   */
  async sendJson(data: unknown): Promise<void> {
    const json = JSON.stringify(data);
    await this.sendStr(json);
  }

  /**
   * Send ping frame
   */
  async ping(data?: Buffer | string): Promise<void> {
    const buffer = data
      ? Buffer.isBuffer(data)
        ? data
        : Buffer.from(data, "utf-8")
      : Buffer.alloc(0);
    await this.sendRaw(buffer, CurlWsFlag.CURLWS_PING);
  }

  /**
   * Send pong frame (usually auto-sent in response to ping)
   */
  private async sendPong(data: Buffer): Promise<void> {
    await this.sendRaw(data, CurlWsFlag.CURLWS_PONG);
  }

  /**
   * Close the WebSocket connection
   */
  async close(code: number = 1000, reason: string = ""): Promise<void> {
    if (this._closed) return;

    // Build close frame payload
    const reasonBytes = Buffer.from(reason, "utf-8");
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);

    try {
      await this.sendRaw(payload, CurlWsFlag.CURLWS_CLOSE);
    } catch {
      // Ignore send errors during close
    }

    this._closeEvent = { code, reason, wasClean: true };
    this._closed = true;
    this._connected = false;

    // Stop any pending polls
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Cleanup
    this.curl.cleanup();
  }

  /**
   * Async iterator for receiving messages
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<WebSocketMessage> {
    while (!this._closed) {
      try {
        yield await this.recv();
      } catch (error) {
        if (error instanceof WebSocketClosed) {
          return;
        }
        throw error;
      }
    }
  }
}

/**
 * Connect to a WebSocket server
 */
export async function wsConnect(
  url: string,
  options?: WebSocketOptions
): Promise<AsyncWebSocket> {
  return AsyncWebSocket.connect(url, options);
}
