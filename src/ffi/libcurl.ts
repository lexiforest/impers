import koffi from "koffi";
import { resolveLibcurlPath } from "../utils/platform.js";

const lib = koffi.load(await resolveLibcurlPath());

// Type aliases for clarity
type CurlHandle = unknown;
type CurlMultiHandle = unknown;
type CurlSList = unknown;
type CurlMime = unknown;
type CurlMimePart = unknown;

// Pointer types for koffi
const CURL = koffi.pointer("void");
const CURLM = koffi.pointer("void");
const curl_slist_ptr = koffi.pointer("void");
const curl_mime_ptr = koffi.pointer("void");
const curl_mimepart_ptr = koffi.pointer("void");

// Struct for curl_multi_info_read result
// Note: On 64-bit systems, there is padding after msg to align easy_handle
// The data union contains both void* and CURLcode - we use void* for correct alignment
const CURLMsg = koffi.struct("CURLMsg", {
  msg: "int",
  _pad: "int",           // 4 bytes padding for 64-bit alignment
  easy_handle: "void *", // 8 bytes
  data: "void *",        // Union as void* for proper 64-bit alignment (result is in low 4 bytes)
});

// WebSocket frame metadata struct
const curl_ws_frame = koffi.struct("curl_ws_frame", {
  age: "int",
  flags: "int",
  offset: "int64",
  bytesleft: "int64",
  len: "size_t",
});

// ============================================================================
// Easy Interface Functions
// ============================================================================

const curl_easy_init = lib.func("void * curl_easy_init()");
const curl_easy_cleanup = lib.func("void curl_easy_cleanup(void *)");
const curl_easy_perform = lib.func("int curl_easy_perform(void *)");

/**
 * Async version of curl_easy_perform that runs in a worker thread
 * via Koffi's .async() support. This avoids blocking the event loop,
 * which is critical when the mock server runs in the same process.
 */
function curl_easy_perform_async(handle: CurlHandle): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    (curl_easy_perform as unknown as { async: (handle: CurlHandle, cb: (err: Error | null, code: number) => void) => void })
      .async(handle, (err: Error | null, code: number) => {
        if (err) reject(err);
        else resolve(code);
      });
  });
}
const curl_easy_duphandle = lib.func("void * curl_easy_duphandle(void *)");
const curl_easy_reset = lib.func("void curl_easy_reset(void *)");
const curl_easy_strerror = lib.func("const char * curl_easy_strerror(int)");

// curl_easy_setopt is variadic - we need wrapper functions
const curl_easy_setopt_variadic = lib.func("int curl_easy_setopt(void *, int, ...)");

function curl_easy_setopt_long(
  handle: CurlHandle,
  option: number,
  value: number
): number {
  return curl_easy_setopt_variadic(handle, option, "int", value) as number;
}

function curl_easy_setopt_string(
  handle: CurlHandle,
  option: number,
  value: string
): number {
  return curl_easy_setopt_variadic(handle, option, "str", value) as number;
}

function curl_easy_setopt_ptr(
  handle: CurlHandle,
  option: number,
  value: unknown
): number {
  return curl_easy_setopt_variadic(handle, option, "void *", value) as number;
}

function curl_easy_setopt_int64(
  handle: CurlHandle,
  option: number,
  value: bigint
): number {
  return curl_easy_setopt_variadic(handle, option, "int64", value) as number;
}

function curl_easy_setopt_blob(
  handle: CurlHandle,
  option: number,
  data: Buffer,
  flags: number
): number {
  // Create a curl_blob struct inline
  const blob = { data, len: data.length, flags };
  return curl_easy_setopt_variadic(handle, option, "void *", blob) as number;
}

// curl_easy_getinfo is also variadic
const curl_easy_getinfo_variadic = lib.func("int curl_easy_getinfo(void *, int, ...)");

function curl_easy_getinfo_long(
  handle: CurlHandle,
  info: number
): { code: number; value: number } {
  const out = new Int32Array(1);
  const code = curl_easy_getinfo_variadic(handle, info, "int *", out) as number;
  return { code, value: out[0] };
}

function curl_easy_getinfo_double(
  handle: CurlHandle,
  info: number
): { code: number; value: number } {
  const out = new Float64Array(1);
  const code = curl_easy_getinfo_variadic(handle, info, "double *", out) as number;
  return { code, value: out[0] };
}

function curl_easy_getinfo_string(
  handle: CurlHandle,
  info: number
): { code: number; value: string | null } {
  const out = [null] as [string | null];
  const code = curl_easy_getinfo_variadic(handle, info, "char **", out) as number;
  return { code, value: out[0] };
}

function curl_easy_getinfo_slist(
  handle: CurlHandle,
  info: number
): { code: number; value: CurlSList | null } {
  const out = [null] as [CurlSList | null];
  const code = curl_easy_getinfo_variadic(handle, info, "void **", out) as number;
  return { code, value: out[0] };
}

function curl_easy_getinfo_off_t(
  handle: CurlHandle,
  info: number
): { code: number; value: bigint } {
  const out = new BigInt64Array(1);
  const code = curl_easy_getinfo_variadic(handle, info, "int64 *", out) as number;
  return { code, value: out[0] };
}

function curl_easy_getinfo_socket(
  handle: CurlHandle,
  info: number
): { code: number; value: number } {
  const out = new Int32Array(1);
  const code = curl_easy_getinfo_variadic(handle, info, "int *", out) as number;
  return { code, value: out[0] };
}

function curl_easy_getinfo_ptr(
  handle: CurlHandle,
  info: number
): { code: number; value: unknown } {
  const out = [null] as [unknown];
  const code = curl_easy_getinfo_variadic(handle, info, "void **", out) as number;
  return { code, value: out[0] };
}

// ============================================================================
// Version Functions
// ============================================================================

const curl_version = lib.func("const char * curl_version()");

// curl_version_info returns a pointer to a static struct
// We define a simplified version info struct for reading
const curl_version_info_data = koffi.struct("curl_version_info_data", {
  age: "int",
  version: "const char *",
  version_num: "uint32",
  host: "const char *",
  features: "int",
  ssl_version: "const char *",
  ssl_version_num: "long", // deprecated
  libz_version: "const char *",
  protocols: "const char **",
  ares: "const char *",
  ares_num: "int",
  libidn: "const char *",
  iconv_ver_num: "int",
  libssh_version: "const char *",
  brotli_ver_num: "uint32",
  brotli_version: "const char *",
  nghttp2_ver_num: "uint32",
  nghttp2_version: "const char *",
  quic_version: "const char *",
  cainfo: "const char *",
  capath: "const char *",
  zstd_ver_num: "uint32",
  zstd_version: "const char *",
  hyper_version: "const char *",
  gsasl_version: "const char *",
  feature_names: "const char **",
});

const curl_version_info_fn = lib.func("void * curl_version_info(int)");

function curl_version_info(age: number): unknown {
  const ptr = curl_version_info_fn(age);
  if (!ptr) return null;
  return koffi.decode(ptr, curl_version_info_data);
}

// ============================================================================
// SList Functions
// ============================================================================

const curl_slist_append = lib.func("void * curl_slist_append(void *, const char *)");
const curl_slist_free_all = lib.func("void curl_slist_free_all(void *)");

// ============================================================================
// Multi Interface Functions
// ============================================================================

const curl_multi_init = lib.func("void * curl_multi_init()");
const curl_multi_cleanup = lib.func("int curl_multi_cleanup(void *)");
const curl_multi_add_handle = lib.func("int curl_multi_add_handle(void *, void *)");
const curl_multi_remove_handle = lib.func("int curl_multi_remove_handle(void *, void *)");
const curl_multi_strerror = lib.func("const char * curl_multi_strerror(int)");
const curl_multi_wakeup = lib.func("int curl_multi_wakeup(void *)");

// curl_multi_socket_action(CURLM *multi, curl_socket_t s, int ev_bitmask, int *running_handles)
const curl_multi_socket_action_fn = lib.func(
  "int curl_multi_socket_action(void *, int, int, int *)"
);

function curl_multi_socket_action(
  multi: CurlMultiHandle,
  socket: number,
  evBitmask: number
): { code: number; runningHandles: number } {
  const running = new Int32Array(1);
  const code = curl_multi_socket_action_fn(multi, socket, evBitmask, running) as number;
  return { code, runningHandles: running[0] };
}

// curl_multi_perform(CURLM *multi, int *running_handles)
const curl_multi_perform_fn = lib.func("int curl_multi_perform(void *, int *)");

function curl_multi_perform(
  multi: CurlMultiHandle
): { code: number; runningHandles: number } {
  const running = new Int32Array(1);
  const code = curl_multi_perform_fn(multi, running) as number;
  return { code, runningHandles: running[0] };
}

// curl_multi_poll(CURLM *multi, struct curl_waitfd extra_fds[], unsigned int extra_nfds, int timeout_ms, int *numfds)
const curl_multi_poll_fn = lib.func(
  "int curl_multi_poll(void *, void *, uint32, int, int *)"
);

function curl_multi_poll(
  multi: CurlMultiHandle,
  timeoutMs: number
): { code: number; numfds: number } {
  const numfds = new Int32Array(1);
  const code = curl_multi_poll_fn(multi, null, 0, timeoutMs, numfds) as number;
  return { code, numfds: numfds[0] };
}

// curl_multi_timeout(CURLM *multi, long *timeout)
const curl_multi_timeout_fn = lib.func("int curl_multi_timeout(void *, long *)");

function curl_multi_timeout(
  multi: CurlMultiHandle
): { code: number; timeoutMs: number } {
  const timeout = new Int32Array(1);
  const code = curl_multi_timeout_fn(multi, timeout) as number;
  return { code, timeoutMs: timeout[0] };
}

// curl_multi_info_read(CURLM *multi, int *msgs_in_queue) -> CURLMsg*
const curl_multi_info_read_fn = lib.func("void * curl_multi_info_read(void *, int *)");

interface MultiInfoMessage {
  msg: number;
  easyHandle: CurlHandle;
  result: number;
}

function curl_multi_info_read(
  multi: CurlMultiHandle
): { message: MultiInfoMessage | null; msgsInQueue: number } {
  const msgsInQueue = new Int32Array(1);
  const msgPtr = curl_multi_info_read_fn(multi, msgsInQueue);

  if (!msgPtr) {
    return { message: null, msgsInQueue: msgsInQueue[0] };
  }

  // Decode the raw bytes to get the result as an integer
  // CURLMsg layout: int msg (4) + int pad (4) + void* easy_handle (8) + union data (8)
  const rawBytes = koffi.decode(msgPtr, koffi.array("uint8", 24)) as number[];
  const buffer = Buffer.from(rawBytes);

  const msgType = buffer.readInt32LE(0);
  const result = buffer.readInt32LE(16); // Result is at offset 16 (first 4 bytes of union)

  // Decode the struct to get the easy_handle pointer
  const msg = koffi.decode(msgPtr, CURLMsg) as {
    msg: number;
    _pad: number;
    easy_handle: unknown;
    data: unknown;
  };

  return {
    message: {
      msg: msgType,
      easyHandle: msg.easy_handle,
      result: result,
    },
    msgsInQueue: msgsInQueue[0],
  };
}

// curl_multi_setopt is variadic
const curl_multi_setopt_variadic = lib.func("int curl_multi_setopt(void *, int, ...)");

function curl_multi_setopt_long(
  multi: CurlMultiHandle,
  option: number,
  value: number
): number {
  return curl_multi_setopt_variadic(multi, option, "int", value) as number;
}

function curl_multi_setopt_ptr(
  multi: CurlMultiHandle,
  option: number,
  value: unknown
): number {
  return curl_multi_setopt_variadic(multi, option, "void *", value) as number;
}

function curl_multi_setopt_off_t(
  multi: CurlMultiHandle,
  option: number,
  value: bigint
): number {
  return curl_multi_setopt_variadic(multi, option, "int64", value) as number;
}

// ============================================================================
// WebSocket Functions
// ============================================================================

// curl_ws_recv(CURL *curl, void *buffer, size_t buflen, size_t *recv, const struct curl_ws_frame **meta)
const curl_ws_recv_fn = lib.func(
  "int curl_ws_recv(void *, void *, size_t, size_t *, void **)"
);

interface WsFrame {
  flags: number;
  offset: bigint;
  bytesleft: bigint;
  len: number;
}

function curl_ws_recv(
  handle: CurlHandle,
  buffer: Buffer
): { code: number; received: number; frame: WsFrame | null } {
  const recv = new BigUint64Array(1);
  const metaPtr = [null] as [unknown];

  const code = curl_ws_recv_fn(handle, buffer, buffer.length, recv, metaPtr) as number;

  let frame: WsFrame | null = null;
  if (metaPtr[0]) {
    const meta = koffi.decode(metaPtr[0], curl_ws_frame) as {
      flags: number;
      offset: bigint;
      bytesleft: bigint;
      len: number;
    };
    frame = {
      flags: meta.flags,
      offset: BigInt(meta.offset),
      bytesleft: BigInt(meta.bytesleft),
      len: Number(meta.len),
    };
  }

  return { code, received: Number(recv[0]), frame };
}

// curl_ws_send(CURL *curl, const void *buffer, size_t buflen, size_t *sent, curl_off_t fragsize, unsigned int flags)
const curl_ws_send_fn = lib.func(
  "int curl_ws_send(void *, void *, size_t, size_t *, int64, uint32)"
);

function curl_ws_send(
  handle: CurlHandle,
  buffer: Buffer,
  flags: number,
  fragsize: bigint = BigInt(0)
): { code: number; sent: number } {
  const sent = new BigUint64Array(1);
  const code = curl_ws_send_fn(handle, buffer, buffer.length, sent, fragsize, flags) as number;
  return { code, sent: Number(sent[0]) };
}

// curl_ws_meta(CURL *curl) -> const struct curl_ws_frame*
const curl_ws_meta_fn = lib.func("void * curl_ws_meta(void *)");

function curl_ws_meta(handle: CurlHandle): WsFrame | null {
  const metaPtr = curl_ws_meta_fn(handle);
  if (!metaPtr) {
    return null;
  }

  const meta = koffi.decode(metaPtr, curl_ws_frame) as {
    flags: number;
    offset: bigint;
    bytesleft: bigint;
    len: number;
  };
  return {
    flags: meta.flags,
    offset: BigInt(meta.offset),
    bytesleft: BigInt(meta.bytesleft),
    len: Number(meta.len),
  };
}

// ============================================================================
// MIME Functions
// ============================================================================

const curl_mime_init = lib.func("void * curl_mime_init(void *)");
const curl_mime_free = lib.func("void curl_mime_free(void *)");
const curl_mime_addpart = lib.func("void * curl_mime_addpart(void *)");
const curl_mime_name = lib.func("int curl_mime_name(void *, const char *)");
const curl_mime_filename = lib.func("int curl_mime_filename(void *, const char *)");
const curl_mime_type = lib.func("int curl_mime_type(void *, const char *)");
const curl_mime_data = lib.func("int curl_mime_data(void *, void *, size_t)");
const curl_mime_filedata = lib.func("int curl_mime_filedata(void *, const char *)");
const curl_mime_subparts = lib.func("int curl_mime_subparts(void *, void *)");
const curl_mime_headers = lib.func("int curl_mime_headers(void *, void *, int)");
const curl_mime_encoder = lib.func("int curl_mime_encoder(void *, const char *)");

// ============================================================================
// Impersonation Functions (curl-impersonate specific)
// ============================================================================

// These functions only exist in curl-impersonate, not standard libcurl
// We try to load them but handle the case where they don't exist

let curl_easy_impersonate: ((handle: CurlHandle, target: string, defaultHeaders: number) => number) | null = null;

try {
  const impersonate_fn = lib.func("int curl_easy_impersonate(void *, const char *, int)");
  curl_easy_impersonate = (handle: CurlHandle, target: string, defaultHeaders: number) => {
    return impersonate_fn(handle, target, defaultHeaders) as number;
  };
} catch {
  // Function doesn't exist - using standard libcurl
  curl_easy_impersonate = null;
}

function hasImpersonateSupport(): boolean {
  return curl_easy_impersonate !== null;
}

// ============================================================================
// Exports
// ============================================================================

export {
  koffi,
  // Type aliases
  type CurlHandle,
  type CurlMultiHandle,
  type CurlSList,
  type CurlMime,
  type CurlMimePart,
  type WsFrame,
  type MultiInfoMessage,
  // Pointer types
  CURL,
  CURLM,
  curl_slist_ptr,
  curl_mime_ptr,
  curl_mimepart_ptr,
  // Easy interface
  curl_easy_init,
  curl_easy_cleanup,
  curl_easy_perform,
  curl_easy_perform_async,
  curl_easy_duphandle,
  curl_easy_reset,
  curl_easy_strerror,
  curl_easy_setopt_long,
  curl_easy_setopt_string,
  curl_easy_setopt_ptr,
  curl_easy_setopt_int64,
  curl_easy_setopt_blob,
  curl_easy_getinfo_long,
  curl_easy_getinfo_double,
  curl_easy_getinfo_string,
  curl_easy_getinfo_slist,
  curl_easy_getinfo_off_t,
  curl_easy_getinfo_socket,
  curl_easy_getinfo_ptr,
  // Version
  curl_version,
  curl_version_info,
  // SList
  curl_slist_append,
  curl_slist_free_all,
  // Multi interface
  curl_multi_init,
  curl_multi_cleanup,
  curl_multi_add_handle,
  curl_multi_remove_handle,
  curl_multi_perform,
  curl_multi_poll,
  curl_multi_socket_action,
  curl_multi_timeout,
  curl_multi_info_read,
  curl_multi_setopt_long,
  curl_multi_setopt_ptr,
  curl_multi_setopt_off_t,
  curl_multi_strerror,
  curl_multi_wakeup,
  // WebSocket
  curl_ws_recv,
  curl_ws_send,
  curl_ws_meta,
  // MIME
  curl_mime_init,
  curl_mime_free,
  curl_mime_addpart,
  curl_mime_name,
  curl_mime_filename,
  curl_mime_type,
  curl_mime_data,
  curl_mime_filedata,
  curl_mime_subparts,
  curl_mime_headers,
  curl_mime_encoder,
  // Impersonation
  curl_easy_impersonate,
  hasImpersonateSupport,
  // Utility
  getHandleAddress,
};

/**
 * Get the address of a koffi External handle as a string.
 * This allows comparing handles that point to the same memory.
 */
function getHandleAddress(handle: unknown): string {
  // koffi.address() returns the address as a BigInt
  // We convert to hex string for use as a Map key
  try {
    const addr = koffi.address(handle);
    return addr.toString(16);
  } catch {
    // Fallback: try to extract from string representation
    const str = Object.prototype.toString.call(handle);
    const match = String(handle).match(/External:\s*([0-9a-f]+)/i);
    return match ? match[1] : String(handle);
  }
}
