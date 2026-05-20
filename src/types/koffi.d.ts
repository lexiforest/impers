declare module "koffi" {
  type KoffiLibrary = {
    func(signature: string): (...args: unknown[]) => unknown;
  };

  type KoffiType = unknown;

  const koffi: {
    load(path: string): KoffiLibrary;

    // Type definitions
    struct(name: string, members: Record<string, string>): KoffiType;
    pointer(type: string | KoffiType): KoffiType;
    out(type: string | KoffiType): KoffiType;
    inout(type: string | KoffiType): KoffiType;

    // Callback/function pointer support
    proto(signature: string): KoffiType;
    register(fn: unknown, type: KoffiType): unknown;
    unregister(fn: unknown): void;
    callback(signature: string, fn: unknown): unknown;

    // Memory operations
    decode(value: unknown, type: string | KoffiType): unknown;
    encode(ref: unknown, type: string | KoffiType, value: unknown): void;
    encode(ref: unknown, type: string | KoffiType, value: unknown, len: number): void;
    encode(ref: unknown, offset: number, type: string | KoffiType, value: unknown): void;
    encode(ref: unknown, offset: number, type: string | KoffiType, value: unknown, len: number): void;
    view(ref: unknown, len: number): ArrayBuffer;

    // Utility
    sizeof(type: string | KoffiType): number;
    alignof(type: string | KoffiType): number;
    array(type: string | KoffiType, length: number): KoffiType;

    // Pointer operations
    address(value: unknown): bigint;

    // Introspection
    introspect(type: KoffiType): unknown;

    node: {
      poll(
        fd: number,
        opts: { readable?: boolean; writable?: boolean; disconnect?: boolean },
        callback: (
          status: number,
          events: { readable: boolean; writable: boolean; disconnect: boolean }
        ) => void
      ): {
        start(
          opts: { readable?: boolean; writable?: boolean; disconnect?: boolean },
          callback: (
            status: number,
            events: { readable: boolean; writable: boolean; disconnect: boolean }
          ) => void
        ): void;
        stop(): void;
        close(): void;
        unref(): void;
        ref(): void;
      };
    };
  };

  export default koffi;
}
