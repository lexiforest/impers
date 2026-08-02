import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Curl } from "../src/core/easy.js";
import { CurlOpt } from "../src/ffi/constants.js";
import {
  Fingerprint,
  FingerprintManager,
  resolveNativeImpersonateTarget,
} from "../src/fingerprints.js";
import { applyFingerprintOptions } from "../src/utils/fingerprint.js";

function createEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    IMPERSONATE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "impers-fingerprints-")),
  };
}

class FakeCurl {
  options = new Map<number, unknown>();
  stringLists = new Map<number, string[]>();

  setOpt(option: number, value: unknown): void {
    this.options.set(option, value);
  }

  setStringList(option: number, values: string[]): void {
    this.stringLists.set(option, values);
  }
}

describe("Fingerprint", () => {
  it("uses the same defaults as curl_cffi", () => {
    const fingerprint = new Fingerprint();

    expect(fingerprint.http_version).toBe("v2");
    expect(fingerprint.tls_version).toBe("1.2");
    expect(fingerprint.tls_key_shares_limit).toBe(2);
    expect(fingerprint.http3_headers).toEqual({});
    expect(fingerprint.ws_tls_cert_compression).toBeNull();
  });

  it("loads current HTTP/3 and WebSocket fields and returns an editable copy", () => {
    const env = createEnv();
    writeFileSync(
      FingerprintManager.getFingerprintPath(env),
      JSON.stringify({
        custom: {
          headers: { "User-Agent": "fingerprint-agent" },
          http3_headers: { "User-Agent": "h3-agent" },
          http3_header_order: "User-Agent",
          http3_tls_supported_groups: ["X25519", "P-256"],
          ws_headers: { "User-Agent": "ws-agent" },
          ws_header_order: "User-Agent",
          ws_disable_session_ticket: true,
          ws_tls_cert_compression: [],
          ignored_future_field: "ignored",
        },
      })
    );

    const fingerprint = FingerprintManager.getFingerprint("custom", env);

    expect(fingerprint).toBeInstanceOf(Fingerprint);
    expect(fingerprint.http3_headers).toEqual({ "User-Agent": "h3-agent" });
    expect(fingerprint.http3_tls_supported_groups).toEqual(["X25519", "P-256"]);
    expect(fingerprint.ws_headers).toEqual({ "User-Agent": "ws-agent" });
    expect(fingerprint.ws_disable_session_ticket).toBe(true);
    expect(fingerprint.ws_tls_cert_compression).toEqual([]);
    expect(fingerprint).not.toHaveProperty("ignored_future_field");

    fingerprint.headers["User-Agent"] = "edited-agent";
    expect(FingerprintManager.getFingerprint("custom", env).headers["User-Agent"])
      .toBe("fingerprint-agent");
  });

  it("contains the current native targets and resolves aliases", () => {
    const env = createEnv();
    const rows = FingerprintManager.listFingerprints(env);

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "chrome146", h3_fingerprints: true }),
      expect.objectContaining({ name: "firefox147", h3_fingerprints: true }),
      expect.objectContaining({ name: "tor145" }),
    ]));
    expect(resolveNativeImpersonateTarget("chrome")).toBe("chrome146");
    expect(resolveNativeImpersonateTarget("safari18_4_ios")).toBe("safari184_ios");
    expect(resolveNativeImpersonateTarget("custom")).toBeNull();
  });

  it("applies TLS, HTTP/2, HTTP/3, and WebSocket fields", () => {
    const curl = new FakeCurl();
    const fingerprint = new Fingerprint({
      tls_extension_order: "0-21-11",
      tls_supported_groups: ["X25519Kyber768", "P-256"],
      tls_cert_compression: ["zlib"],
      http2_settings: "1:65536;3:1000",
      header_order: "User-Agent,Host",
      http3_headers: { "User-Agent": "h3-agent" },
      http3_header_order: "User-Agent",
      http3_tls_supported_groups: ["X25519Kyber768", "P-256"],
      ws_headers: { "User-Agent": "ws-agent" },
      ws_header_order: "User-Agent",
      ws_disable_session_ticket: true,
      ws_tls_cert_compression: [],
    });

    applyFingerprintOptions(curl as unknown as Curl, fingerprint);

    expect(curl.options.get(CurlOpt.TLS_EXTENSION_ORDER)).toBe("0-11");
    expect(curl.options.get(CurlOpt.SSL_EC_CURVES))
      .toBe("X25519Kyber768Draft00:P-256");
    expect(curl.options.get(CurlOpt.SSL_CERT_COMPRESSION)).toBe("zlib");
    expect(curl.options.get(CurlOpt.TLS_STATUS_REQUEST)).toBe(1);
    expect(curl.options.get(CurlOpt.TLS_SIGNED_CERT_TIMESTAMPS)).toBe(1);
    expect(curl.options.get(CurlOpt.HTTP2_SETTINGS)).toBe("1:65536;3:1000");
    expect(curl.options.get(CurlOpt.HTTPHEADER_ORDER)).toBe("User-Agent,Host");
    expect(curl.options.get(CurlOpt.HTTP3_HTTPHEADER_ORDER)).toBe("User-Agent");
    expect(curl.options.get(CurlOpt.HTTP3_SSL_EC_CURVES))
      .toBe("X25519Kyber768Draft00:P-256");
    expect(curl.stringLists.get(CurlOpt.HTTP3_HTTPHEADER)).toEqual([
      "User-Agent: h3-agent",
    ]);
    expect(curl.stringLists.get(CurlOpt.WS_HTTPHEADER)).toEqual([
      "User-Agent: ws-agent",
    ]);
    expect(curl.options.get(CurlOpt.WS_SSL_DISABLE_TICKET)).toBe(1);
    expect(curl.options.get(CurlOpt.WS_SSL_CERT_COMPRESSION)).toBe("");
  });

  it("does not apply protocol-specific default headers when disabled", () => {
    const curl = new FakeCurl();
    const fingerprint = new Fingerprint({
      http3_headers: { "User-Agent": "h3-agent" },
      ws_headers: { "User-Agent": "ws-agent" },
    });

    applyFingerprintOptions(curl as unknown as Curl, fingerprint, false);

    expect(curl.stringLists.has(CurlOpt.HTTP3_HTTPHEADER)).toBe(false);
    expect(curl.stringLists.has(CurlOpt.WS_HTTPHEADER)).toBe(false);
  });

  it("updates all pages from the fingerprint API", async () => {
    const env = createEnv();
    env.IMPERSONATE_API_ROOT = `${globalThis.TEST_SERVER_URL}/paginated`;

    const updated = await FingerprintManager.updateFingerprints(env);

    expect(updated).toBe(102);
    const cache = JSON.parse(
      readFileSync(FingerprintManager.getFingerprintPath(env), "utf8")
    ) as Record<string, unknown>;
    expect(cache).toHaveProperty("testing0");
    expect(cache).toHaveProperty("testing101");
  });
});
