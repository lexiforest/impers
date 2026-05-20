import { koffi } from "../ffi/libcurl.js";

export type WriteCallback = (chunk: Buffer) => number | void;
export type ReadCallback = (size: number) => Buffer | string | null | undefined;

const koffiTypeSuffix = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const WriteCallbackProto = koffi.proto(
  `size_t WriteCallback_${koffiTypeSuffix}(void *, size_t, size_t, void *)`
);
const ReadCallbackProto = koffi.proto(
  `size_t ReadCallback_${koffiTypeSuffix}(void *, size_t, size_t, void *)`
);

export function wrapWriteCallback(fn: WriteCallback): unknown {
  return koffi.register(
    (data: unknown, size: number, nmemb: number) => {
      const length = Number(size * nmemb);
      if (length === 0) {
        return 0;
      }

      let chunk: Buffer;
      if (Buffer.isBuffer(data)) {
        chunk = data.subarray(0, length);
      } else {
        // Decode raw bytes from the pointer instead of treating it as a C string.
        const raw = koffi.decode(data, koffi.array("uint8", length)) as number[];
        chunk = Buffer.from(raw);
      }

      return fn(chunk) ?? length;
    },
    koffi.pointer(WriteCallbackProto)
  );
}

export function wrapReadCallback(fn: ReadCallback): unknown {
  let pending: Buffer = Buffer.alloc(0);

  return koffi.register(
    (data: unknown, size: number, nmemb: number) => {
      const length = Number(size * nmemb);
      if (length === 0) {
        return 0;
      }

      if (pending.length === 0) {
        const chunk = fn(length);
        if (chunk === null || chunk === undefined) {
          return 0;
        }

        pending = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, "utf-8");
      }

      const bytesToWrite = Math.min(pending.length, length);
      if (bytesToWrite === 0) {
        return 0;
      }

      const target = Buffer.isBuffer(data)
        ? data.subarray(0, length)
        : Buffer.from(koffi.view(data, length));
      pending.copy(target, 0, 0, bytesToWrite);
      pending = pending.subarray(bytesToWrite);
      return bytesToWrite;
    },
    koffi.pointer(ReadCallbackProto)
  );
}
