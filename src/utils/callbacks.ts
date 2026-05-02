import { koffi } from "../ffi/libcurl.js";

export type WriteCallback = (chunk: Buffer) => number | void;

const koffiTypeSuffix = `${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const WriteCallbackProto = koffi.proto(
  `size_t WriteCallback_${koffiTypeSuffix}(void *, size_t, size_t, void *)`
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
