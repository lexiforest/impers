import {
  curl_multi_init,
  curl_multi_cleanup,
  curl_multi_add_handle,
  curl_multi_remove_handle,
  curl_multi_socket_action,
  curl_multi_info_read,
  curl_multi_setopt_long,
  curl_multi_setopt_ptr,
  curl_multi_strerror,
  koffi,
  getHandleAddress,
  type CurlMultiHandle,
  type CurlHandle,
} from "../ffi/libcurl.js";
import {
  CurlMCode,
  CurlMOpt,
  CurlMsg,
  CurlCode,
  CurlPoll,
  CurlCSelect,
  CURL_SOCKET_TIMEOUT,
} from "../ffi/constants.js";
import type { Curl } from "./easy.js";

export interface MultiOptions {
  maxConnections?: number;
  maxHostConnections?: number;
  maxTotalConnections?: number;
  pipelining?: boolean;
}

interface PendingTransfer {
  curl: Curl;
  handle: CurlHandle;
  handleAddr: string; // Address of the handle for lookup
  resolve: (result: TransferResult) => void;
  reject: (error: Error) => void;
}

export interface TransferResult {
  code: number;
}

type PollEvents = {
  readable: boolean;
  writable: boolean;
  disconnect: boolean;
};

type PollHandle = ReturnType<typeof koffi.node.poll>;

const SocketCallbackProto = koffi.proto(
  "int CurlMultiSocketCallback(void *, int, int, void *, void *)"
);
const TimerCallbackProto = koffi.proto(
  "int CurlMultiTimerCallback(void *, long, void *)"
);

/**
 * CurlMulti - Async multi-handle interface for concurrent requests
 *
 * Uses libcurl's socket action API to integrate with Node.js' event loop.
 * This allows multiple HTTP requests to run concurrently without blocking.
 */
export class CurlMulti {
  private handle: CurlMultiHandle | null;
  private pendingTransfers: Map<string, PendingTransfer> = new Map(); // keyed by handle address
  private curlToAddr: Map<Curl, string> = new Map();
  private polling: boolean = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private socketPolls: Map<number, PollHandle> = new Map();
  private socketCallback: unknown | null = null;
  private timerCallback: unknown | null = null;
  private closed: boolean = false;

  constructor(options: MultiOptions = {}) {
    this.handle = curl_multi_init();
    if (!this.handle) {
      throw new Error("Failed to initialize curl multi handle");
    }

    // Configure multi handle options
    if (options.maxConnections !== undefined) {
      this.setOptLong(CurlMOpt.CURLMOPT_MAXCONNECTS, options.maxConnections);
    }
    if (options.maxHostConnections !== undefined) {
      this.setOptLong(CurlMOpt.CURLMOPT_MAX_HOST_CONNECTIONS, options.maxHostConnections);
    }
    if (options.maxTotalConnections !== undefined) {
      this.setOptLong(CurlMOpt.CURLMOPT_MAX_TOTAL_CONNECTIONS, options.maxTotalConnections);
    }
    if (options.pipelining !== undefined) {
      // 2 = CURLPIPE_MULTIPLEX for HTTP/2 multiplexing
      this.setOptLong(CurlMOpt.CURLMOPT_PIPELINING, options.pipelining ? 2 : 0);
    }

    this.configureSocketCallbacks();
  }

  private setOptLong(option: number, value: number): void {
    if (!this.handle) return;
    const code = curl_multi_setopt_long(this.handle, option, value);
    if (code !== CurlMCode.CURLM_OK) {
      throw new Error(`curl_multi_setopt failed: ${curl_multi_strerror(code)}`);
    }
  }

  private setOptPtr(option: number, value: unknown): void {
    if (!this.handle) return;
    const code = curl_multi_setopt_ptr(this.handle, option, value);
    if (code !== CurlMCode.CURLM_OK) {
      throw new Error(`curl_multi_setopt failed: ${curl_multi_strerror(code)}`);
    }
  }

  private configureSocketCallbacks(): void {
    this.socketCallback = koffi.register(
      (_easy: unknown, socket: number, what: number) => this.updateSocketPoll(socket, what),
      koffi.pointer(SocketCallbackProto)
    );
    this.timerCallback = koffi.register(
      (_multi: unknown, timeoutMs: number) => this.updateTimer(timeoutMs),
      koffi.pointer(TimerCallbackProto)
    );

    this.setOptPtr(CurlMOpt.CURLMOPT_SOCKETFUNCTION, this.socketCallback);
    this.setOptPtr(CurlMOpt.CURLMOPT_TIMERFUNCTION, this.timerCallback);
  }

  /**
   * Add a Curl handle and perform the transfer asynchronously
   * Returns a Promise that resolves when the transfer completes
   */
  async perform(curl: Curl): Promise<TransferResult> {
    if (this.closed) {
      throw new Error("CurlMulti has been closed");
    }
    if (!this.handle) {
      throw new Error("CurlMulti handle is null");
    }

    const easyHandle = curl.getHandle();
    if (!easyHandle) {
      throw new Error("Curl handle is null");
    }

    return new Promise<TransferResult>((resolve, reject) => {
      // Get the handle address for lookup
      const handleAddr = getHandleAddress(easyHandle);

      // Add to multi handle
      const code = curl_multi_add_handle(this.handle!, easyHandle);
      if (code !== CurlMCode.CURLM_OK) {
        reject(new Error(`curl_multi_add_handle failed: ${curl_multi_strerror(code)}`));
        return;
      }

      // Store pending transfer keyed by handle address
      const transfer: PendingTransfer = { curl, handle: easyHandle, handleAddr, resolve, reject };
      this.pendingTransfers.set(handleAddr, transfer);
      this.curlToAddr.set(curl, handleAddr);

      this.startPolling();
    });
  }

  /**
   * Start the poll loop if not already running
   */
  private startPolling(): void {
    if (this.closed) return;
    this.polling = true;
    this.runSocketAction(CURL_SOCKET_TIMEOUT, 0);
  }

  /**
   * Drive libcurl after a socket or timeout event.
   */
  private runSocketAction(socket: number, events: number): void {
    if (this.closed || !this.handle || this.pendingTransfers.size === 0) {
      this.stopPolling();
      return;
    }

    const { code, runningHandles } = curl_multi_socket_action(this.handle, socket, events);

    if (code !== CurlMCode.CURLM_OK && code !== CurlMCode.CURLM_CALL_MULTI_PERFORM) {
      const error = new Error(`curl_multi_socket_action failed: ${curl_multi_strerror(code)}`);
      this.failAllPending(error);
      this.stopPolling();
      return;
    }

    this.checkCompleted();

    if (runningHandles === 0 && this.pendingTransfers.size === 0) {
      this.stopPolling();
    }
  }

  private updateSocketPoll(socket: number, what: number): number {
    if (this.closed) {
      this.closeSocketPoll(socket);
      return 0;
    }

    if (what === CurlPoll.CURL_POLL_REMOVE || what === CurlPoll.CURL_POLL_NONE) {
      this.closeSocketPoll(socket);
      return 0;
    }

    this.closeSocketPoll(socket);

    try {
      const poll = koffi.node.poll(
        socket,
        {
          readable: what === CurlPoll.CURL_POLL_IN || what === CurlPoll.CURL_POLL_INOUT,
          writable: what === CurlPoll.CURL_POLL_OUT || what === CurlPoll.CURL_POLL_INOUT,
          disconnect: true,
        },
        (status, events) => this.onSocketEvent(socket, status, events)
      );
      this.socketPolls.set(socket, poll);
      return 0;
    } catch {
      return -1;
    }
  }

  private onSocketEvent(socket: number, status: number, events: PollEvents): void {
    if (this.closed) return;

    let eventMask = 0;
    if (events.readable) {
      eventMask |= CurlCSelect.CURL_CSELECT_IN;
    }
    if (events.writable) {
      eventMask |= CurlCSelect.CURL_CSELECT_OUT;
    }
    if (events.disconnect || status < 0) {
      eventMask |= CurlCSelect.CURL_CSELECT_ERR;
    }

    if (eventMask !== 0) {
      this.runSocketAction(socket, eventMask);
    }
  }

  private updateTimer(timeoutMs: number): number {
    this.clearTimer();

    if (this.closed || timeoutMs < 0) {
      return 0;
    }

    // Do not call libcurl recursively from inside the timer callback.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runSocketAction(CURL_SOCKET_TIMEOUT, 0);
    }, timeoutMs);
    return 0;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private closeSocketPoll(socket: number): void {
    const poll = this.socketPolls.get(socket);
    if (!poll) {
      return;
    }

    try {
      poll.close();
    } catch {
      // Ignore poll handles already closed by libuv/Koffi.
    }
    this.socketPolls.delete(socket);
  }

  private closeAllSocketPolls(): void {
    for (const socket of this.socketPolls.keys()) {
      this.closeSocketPoll(socket);
    }
  }

  private stopPolling(): void {
    this.polling = false;
    this.clearTimer();
    this.closeAllSocketPolls();
  }

  /**
   * Find a pending transfer by handle address
   */
  private findPendingByHandle(completedHandle: CurlHandle): PendingTransfer | null {
    const handleAddr = getHandleAddress(completedHandle);
    return this.pendingTransfers.get(handleAddr) || null;
  }

  /**
   * Check for completed transfers and resolve/reject their promises
   */
  private checkCompleted(): void {
    if (!this.handle) return;

    let info = curl_multi_info_read(this.handle);

    while (info.message) {
      const msg = info.message;

      if (msg.msg === CurlMsg.CURLMSG_DONE) {
        const pending = this.findPendingByHandle(msg.easyHandle);

        if (pending) {
          // Remove from multi handle
          curl_multi_remove_handle(this.handle, pending.handle);
          this.pendingTransfers.delete(pending.handleAddr);
          this.curlToAddr.delete(pending.curl);

          // Resolve or reject based on result
          if (msg.result === CurlCode.CURLE_OK) {
            pending.resolve({ code: msg.result });
          } else {
            pending.reject(new Error(`Transfer failed with code ${msg.result}`));
          }
        }
      }

      info = curl_multi_info_read(this.handle);
    }
  }

  /**
   * Fail all pending transfers with an error
   */
  private failAllPending(error: Error): void {
    for (const [, pending] of this.pendingTransfers) {
      if (this.handle) {
        curl_multi_remove_handle(this.handle, pending.handle);
      }
      pending.reject(error);
    }
    this.pendingTransfers.clear();
    this.curlToAddr.clear();
  }

  /**
   * Cancel a specific transfer
   */
  cancel(curl: Curl): boolean {
    if (!this.handle) return false;

    const handleAddr = this.curlToAddr.get(curl);
    if (handleAddr === undefined) return false;

    const pending = this.pendingTransfers.get(handleAddr);
    if (!pending) return false;

    curl_multi_remove_handle(this.handle, pending.handle);
    this.pendingTransfers.delete(handleAddr);
    this.curlToAddr.delete(curl);
    pending.reject(new Error("Transfer cancelled"));

    if (this.pendingTransfers.size === 0) {
      this.stopPolling();
    }

    return true;
  }

  /**
   * Get number of active transfers
   */
  get activeCount(): number {
    return this.pendingTransfers.size;
  }

  /**
   * Check if multi handle is closed
   */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Close the multi handle and cleanup resources
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Fail all pending transfers
    this.failAllPending(new Error("CurlMulti closed"));
    this.stopPolling();

    // Cleanup multi handle
    if (this.handle) {
      this.setOptPtr(CurlMOpt.CURLMOPT_SOCKETFUNCTION, null);
      this.setOptPtr(CurlMOpt.CURLMOPT_TIMERFUNCTION, null);
      curl_multi_cleanup(this.handle);
      this.handle = null;
    }

    this.releaseCallbacks();
  }

  private releaseCallbacks(): void {
    for (const callback of [this.socketCallback, this.timerCallback]) {
      if (!callback) {
        continue;
      }
      try {
        koffi.unregister(callback as Parameters<typeof koffi.unregister>[0]);
      } catch {
        // Ignore callbacks already released during shutdown.
      }
    }
    this.socketCallback = null;
    this.timerCallback = null;
  }
}

// Shared multi instance for simple use cases
let sharedMulti: CurlMulti | null = null;

/**
 * Get or create a shared CurlMulti instance
 */
export function getSharedMulti(): CurlMulti {
  if (!sharedMulti || sharedMulti.isClosed) {
    sharedMulti = new CurlMulti({
      maxTotalConnections: 100,
      maxHostConnections: 6,
      pipelining: true,
    });
  }
  return sharedMulti;
}

/**
 * Close the shared multi instance
 */
export async function closeSharedMulti(): Promise<void> {
  if (sharedMulti) {
    await sharedMulti.close();
    sharedMulti = null;
  }
}
