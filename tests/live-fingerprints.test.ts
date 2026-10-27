import { jest } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FingerprintManager,
  NATIVE_IMPERSONATE_TARGETS,
  type Fingerprint,
} from "../src/fingerprints.js";
import { CurlHttpVersion, CurlOpt, CurlSslOpt } from "../src/ffi/constants.js";
import { libcurlLibraryPath } from "../src/ffi/libcurl.js";
import { Curl } from "../src/core/easy.js";
import { Response } from "../src/http/response.js";
import { Session } from "../src/http/session.js";

const TLS_PEET_URL = "https://peet.impersonate.pro/api/all";
const PING_FP_URL = "https://fp.impersonate.pro/api/auto";
const IGNORED_JA3_EXTENSIONS = new Set(["21", "41", "45"]);
const EXPECTED_LABEL = "expected (API fingerprint)";
const CAPTURED_LABEL = "captured (runtime output)";
const LIVE_TEST_TIMEOUT_MS = 30 * 60 * 1000;

type JsonRecord = Record<string, unknown>;
type FingerprintSources = Record<string, Partial<Record<"http2" | "http3", number>>>;
type Mismatches = Record<string, string[]>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function wrapFingerprintPayload(payload: unknown): JsonRecord | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.fingerprint)) return payload;
  if (isRecord(payload.http2) && isRecord(payload.tls)) {
    return { fingerprint: payload };
  }
  return null;
}

function payloadNameMatches(payload: JsonRecord, target: string): boolean {
  const name = payload.name ?? payload.target;
  return typeof name !== "string" || name === target;
}

function extractTargetPayload(payload: unknown, target: string): JsonRecord | null {
  const wrapped = wrapFingerprintPayload(payload);
  if (wrapped && payloadNameMatches(wrapped, target)) return wrapped;

  if (isRecord(payload)) {
    const nested = wrapFingerprintPayload(payload[target]);
    if (nested) return nested;

    for (const key of ["items", "data"]) {
      const items = payload[key];
      if (!Array.isArray(items)) continue;
      const found = extractTargetFromItems(items, target);
      if (found) return found;
    }
  }

  return Array.isArray(payload) ? extractTargetFromItems(payload, target) : null;
}

function extractTargetFromItems(items: unknown[], target: string): JsonRecord | null {
  for (const item of items) {
    if (!isRecord(item) || (item.name !== target && item.target !== target)) continue;

    const wrapped = wrapFingerprintPayload(item);
    if (wrapped) return wrapped;

    const data = item.data ?? item.fingerprint;
    const nested = wrapFingerprintPayload(data);
    if (nested) {
      return nested.source === undefined && item.source !== undefined
        ? { ...nested, source: item.source }
        : nested;
    }
  }
  return null;
}

async function requestJson(
  session: Session,
  url: string,
  options: { apiKey?: string; impersonate?: string; http3?: boolean } = {}
): Promise<unknown> {
  // CURL_ERROR_SIZE is 256; keep a distinct buffer alive for each transfer.
  const errorBuffer = Buffer.alloc(256);
  let response: Response;
  try {
    response = await session.get(url, {
      headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
      impersonate: options.impersonate,
      curlOptions: {
        [CurlOpt.ERRORBUFFER]: errorBuffer,
        ...(options.http3 ? { [CurlOpt.HTTP_VERSION]: CurlHttpVersion.CURL_HTTP_VERSION_3ONLY } : {}),
      },
      dohUrl: options.http3 ? "https://cloudflare-dns.com/dns-query" : undefined,
      timeout: options.http3 ? 60 : 30,
    });
  } catch (error) {
    const end = errorBuffer.indexOf(0);
    const detail = errorBuffer.subarray(0, end < 0 ? errorBuffer.length : end).toString("utf8");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Request failed: target=${options.impersonate ?? "none"} url=${url} ` +
      `http3=${Boolean(options.http3)} doh=${options.http3 ? "https://cloudflare-dns.com/dns-query" : "none"}\n` +
      `${message}${detail ? `\nlibcurl: ${detail}` : ""}`,
      { cause: error }
    );
  }
  if (response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode} from ${url}: ${response.text}`);
  }
  if (options.http3 && response.httpVersion !== CurlHttpVersion.CURL_HTTP_VERSION_3) {
    throw new Error(`Expected HTTP/3 from ${url}, received ${response.httpVersionString}`);
  }
  return response.json();
}

async function loadRawFingerprint(
  session: Session,
  target: string,
  apiRoot: string,
  protocol: "http2" | "http3",
  apiKey: string,
  sourceId?: number
): Promise<JsonRecord> {
  const baseUrl = `${apiRoot.replace(/\/+$/, "")}/raw`;
  const url = new URL(sourceId === undefined ? baseUrl : `${baseUrl}/${sourceId}`);
  if (sourceId === undefined) {
    url.searchParams.set("name", target);
    url.searchParams.set("protocol", protocol);
  }

  let payload: unknown;
  try {
    payload = await requestJson(session, url.href, { apiKey });
  } catch (error) {
    throw new Error(
      `Could not load raw fingerprint payload for ${JSON.stringify(target)}\n` +
      `${url.href}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const targetPayload = extractTargetPayload(payload, target);
  if (targetPayload) return targetPayload;
  throw new Error(
    `Could not load raw fingerprint payload for ${JSON.stringify(target)}\n` +
    `${url.href}: target not found in response`
  );
}

function getPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const part of path) {
    if (typeof part === "number") {
      if (!Array.isArray(current)) {
        throw new Error(`Expected array while resolving ${JSON.stringify(path)}`);
      }
      current = current[part];
    } else {
      if (!isRecord(current)) {
        throw new Error(`Expected object while resolving ${JSON.stringify(path)}`);
      }
      current = current[part];
    }
  }
  return current;
}

function normalizeCapturedValue(value: unknown): unknown {
  if (typeof value === "string") {
    let normalized = value.replace(/\\"/g, "\"");
    if (normalized.endsWith("\\") && normalized.split("\"").length % 2 === 0) {
      normalized = `${normalized.slice(0, -1)}"`;
    }
    return normalized.replace(/: "([^"]+)\\$/g, ': "$1"');
  }
  if (Array.isArray(value)) return value.map(normalizeCapturedValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeCapturedValue(item)])
    );
  }
  return value;
}

function normalizeJa3(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const parts = value.split(",");
  if (parts.length !== 5) return value;
  parts[2] = parts[2]
    .split("-")
    .filter((extension) => extension && !IGNORED_JA3_EXTENSIONS.has(extension))
    .sort((left, right) => Number(left) - Number(right))
    .join("-");
  return parts.join(",");
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function recordMismatch(
  mismatches: Mismatches,
  target: string,
  dottedPath: string,
  expected: unknown,
  captured: unknown
): void {
  if (JSON.stringify(expected) === JSON.stringify(captured)) return;
  (mismatches[target] ??= []).push([
    dottedPath,
    `${EXPECTED_LABEL}:`,
    formatValue(expected),
    `${CAPTURED_LABEL}:`,
    formatValue(captured),
  ].join("\n"));
}

function verifyApiFingerprint(
  target: string,
  rawPayload: JsonRecord,
  capturedPayload: unknown,
  mismatches: Mismatches
): void {
  const rawFingerprint = getPath(rawPayload, ["fingerprint"]);
  const paths = [
    ["fingerprint", "http2", "akamai_fingerprint_hash"],
    ["fingerprint", "tls", "ja3"],
  ];

  for (const path of paths) {
    if (path[1] === "http2") {
      if (!isRecord(rawFingerprint) || !isRecord(rawFingerprint.http2)) continue;
      if (!isRecord(capturedPayload) || !isRecord(capturedPayload.http2)) continue;
    }
    let expected = getPath(rawPayload, path);
    let captured = normalizeCapturedValue(getPath(capturedPayload, path.slice(1)));
    if (path[1] === "tls") {
      expected = normalizeJa3(expected);
      captured = normalizeJa3(captured);
    }
    recordMismatch(mismatches, target, `$.${path.join(".")}`, expected, captured);
  }
}

function verifyPingFingerprint(
  target: string,
  rawPayload: JsonRecord,
  capturedPayload: unknown,
  mismatches: Mismatches
): void {
  const rawFingerprint = getPath(rawPayload, ["fingerprint"]);
  if (!isRecord(rawFingerprint) || !isRecord(capturedPayload)) {
    throw new Error("Expected ping fingerprints to be objects");
  }

  const expectedJa3 = normalizeJa3(getPath(rawFingerprint, ["tls", "ja3", "text"]));
  const capturedJa3 = normalizeJa3(
    normalizeCapturedValue(getPath(capturedPayload, ["tls", "ja3", "text"]))
  );
  recordMismatch(
    mismatches,
    target,
    "$.fingerprint.tls.ja3.text",
    expectedJa3,
    capturedJa3
  );

  if (!isRecord(rawFingerprint.http2) || !isRecord(capturedPayload.http2)) return;
  for (const field of ["akamai_hash", "akamai_text"]) {
    if (!(field in rawFingerprint.http2) || !(field in capturedPayload.http2)) continue;
    recordMismatch(
      mismatches,
      target,
      `$.fingerprint.http2.${field}`,
      rawFingerprint.http2[field],
      normalizeCapturedValue(capturedPayload.http2[field])
    );
  }
}

function formatMismatches(mismatches: Mismatches): string {
  return Object.keys(mismatches)
    .sort()
    .flatMap((target) => [target, ...mismatches[target]])
    .join("\n\n");
}

async function prepareLiveFingerprints(apiKey: string): Promise<{
  apiRoot: string;
  fingerprints: Record<string, Fingerprint>;
  sources: FingerprintSources;
}> {
  FingerprintManager.setApiKey(apiKey);
  const sources: FingerprintSources = {};
  const get = Session.prototype.get;
  // Capture metadata from the exact pages used to populate the runtime cache.
  Session.prototype.get = async function (url, options) {
    const response = await get.call(this, url, options);
    const body: unknown = response.json();
    if (isRecord(body)) {
      const items = Array.isArray(body.items) ? body.items : body.data;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!isRecord(item)) continue;
          const name = item.name || item.target;
          if (typeof name !== "string") continue;
          sources[name] = {};
          for (const protocol of ["http2", "http3"] as const) {
            const id = item[`${protocol}_source_id`];
            if (typeof id === "number") sources[name][protocol] = id;
          }
        }
      }
    }
    return response;
  };
  try {
    const updated = await FingerprintManager.updateFingerprints();
    expect(updated).toBeGreaterThan(0);
  } finally {
    Session.prototype.get = get;
  }
  const fingerprints = FingerprintManager.loadFingerprints();
  expect(Object.keys(fingerprints).length).toBeGreaterThan(0);
  return { apiRoot: FingerprintManager.getApiRoot(), fingerprints, sources };
}

async function verifyTargets(
  targets: string[],
  fingerprints: Record<string, Fingerprint>,
  apiRoot: string,
  apiKey: string,
  forceHttp3: boolean,
  sources: FingerprintSources
): Promise<void> {
  expect(targets.length).toBeGreaterThan(0);
  const mismatches: Mismatches = {};
  const session = new Session({ maxConnections: 1 });
  try {
    for (const target of targets) {
      if (!process.env.CI) console.log(`verifying${forceHttp3 ? " HTTP/3" : ""} fingerprint: ${target}`);
      const http3 = forceHttp3 || ["v3", "h3"].includes(fingerprints[target].http_version);
      const rawPayload = await loadRawFingerprint(
        session,
        target,
        apiRoot,
        http3 ? "http3" : "http2",
        apiKey,
        sources[target]?.[http3 ? "http3" : "http2"]
      );
      const endpoint = rawPayload.source === "ping" ? PING_FP_URL : TLS_PEET_URL;
      const capturedPayload = await requestJson(session, endpoint, {
        impersonate: target,
        http3,
      });
      if (rawPayload.source === "ping") {
        verifyPingFingerprint(target, rawPayload, capturedPayload, mismatches);
      } else {
        verifyApiFingerprint(target, rawPayload, capturedPayload, mismatches);
      }
    }
  } finally {
    await session.close();
  }
  if (Object.keys(mismatches).length > 0) {
    throw new Error(formatMismatches(mismatches));
  }
}

const liveTest = process.env.IMPERSONATE_API_KEY ? test : test.skip;

describe("live fingerprint verification", () => {
  let previousConfigDir: string | undefined;
  let configDir: string;

  beforeAll(() => {
    if (!process.env.IMPERSONATE_API_KEY) return;
    console.log(`[live] platform=${process.platform} arch=${process.arch} node=${process.version}`);
    console.log(`[live] libcurl path=${libcurlLibraryPath}`);
    console.log(`[live] ${Curl.version()}`);
    if (process.platform === "win32") {
      const curl = new Curl();
      try {
        for (const name of ["SSL_OPTIONS", "PROXY_SSL_OPTIONS"] as const) {
          try {
            curl.setOpt(CurlOpt[name], CurlSslOpt.CURLSSLOPT_NATIVE_CA);
            console.log(`[live] ${name}: native CA option accepted`);
          } catch (error) {
            console.warn(`[live] ${name}: native CA option rejected: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } finally {
        curl.cleanup();
      }
    }
  });

  beforeEach(() => {
    previousConfigDir = process.env.IMPERSONATE_CONFIG_DIR;
    configDir = mkdtempSync(join(tmpdir(), "impers-live-fingerprints-"));
    process.env.IMPERSONATE_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousConfigDir === undefined) {
      delete process.env.IMPERSONATE_CONFIG_DIR;
    } else {
      process.env.IMPERSONATE_CONFIG_DIR = previousConfigDir;
    }
    rmSync(configDir, { recursive: true, force: true });
  });

  function jsonResponse(payload: unknown): Response {
    return new Response({ statusCode: 200, content: Buffer.from(JSON.stringify(payload)) });
  }

  it.each(["http2", "http3"] as const)("loads the linked %s capture by source ID", async (protocol) => {
    const payload = { name: "testing", source: "ping", fingerprint: { protocol } };
    const get = jest.spyOn(Session.prototype, "get").mockResolvedValue(jsonResponse(payload));
    const session = new Session();
    try {
      expect(await loadRawFingerprint(session, "testing", "https://api.test/", protocol, "test-key", 123))
        .toEqual(payload);
      expect(get).toHaveBeenCalledTimes(1);
      expect(get.mock.calls[0][0]).toBe("https://api.test/raw/123");
      expect(get.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer test-key" });
    } finally {
      await session.close();
    }
  });

  it("uses name and protocol for profiles without source metadata", async () => {
    const get = jest.spyOn(Session.prototype, "get").mockResolvedValue(
      jsonResponse({ name: "testing", fingerprint: {} })
    );
    const session = new Session();
    try {
      await loadRawFingerprint(session, "testing", "https://api.test", "http3", "test-key");
      expect(get.mock.calls[0][0]).toBe("https://api.test/raw?name=testing&protocol=http3");
    } finally {
      await session.close();
    }
  });

  it("does not substitute another capture when the linked source fails", async () => {
    const get = jest.spyOn(Session.prototype, "get").mockRejectedValue(new Error("capture not found"));
    const session = new Session();
    try {
      await expect(loadRawFingerprint(session, "testing", "https://api.test", "http2", "test-key", 123))
        .rejects.toThrow("capture not found");
      expect(get).toHaveBeenCalledTimes(1);
      expect(get.mock.calls[0][0]).toBe("https://api.test/raw/123");
    } finally {
      await session.close();
    }
  });

  it("retains source IDs from the same paginated responses as the cached profiles", async () => {
    const get = jest.spyOn(Session.prototype, "get")
      .mockResolvedValueOnce(jsonResponse({
        items: [{ name: "testing", http2_source_id: 123, http3_source_id: 456, fingerprint: { client: "first" } }],
        pagination: { has_more: true, next_skip: 100 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          { target: "testing2", http2_source_id: 789, http3_source_id: null, fingerprint: { client: "second" } },
          { name: "legacy", fingerprint: { client: "legacy" } },
        ],
        pagination: { has_more: false },
      }));
    const { apiRoot, fingerprints, sources } = await prepareLiveFingerprints("test-key");
    expect(sources).toEqual({ testing: { http2: 123, http3: 456 }, testing2: { http2: 789 }, legacy: {} });
    expect(fingerprints.testing.client).toBe("first");
    expect(fingerprints.testing2.client).toBe("second");
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      `${apiRoot}/fingerprints?skip=0&limit=100`,
      `${apiRoot}/fingerprints?skip=100&limit=100`,
    ]);
    expect(Session.prototype.get).toBe(get);
  });

  it("restores the request method if the fingerprint update fails", async () => {
    const get = jest.spyOn(Session.prototype, "get").mockRejectedValue(new Error("update failed"));
    await expect(prepareLiveFingerprints("test-key")).rejects.toThrow("update failed");
    expect(Session.prototype.get).toBe(get);
  });

  it("requires HTTP/3 without fallback and uses DoH with a 60-second timeout", async () => {
    const response = jsonResponse({ ok: true });
    Object.defineProperty(response, "httpVersion", { value: CurlHttpVersion.CURL_HTTP_VERSION_3 });
    const get = jest.spyOn(Session.prototype, "get").mockResolvedValue(response);
    const session = new Session();
    try {
      expect(await requestJson(session, "https://capture.test", { impersonate: "testing", http3: true }))
        .toEqual({ ok: true });
      expect(get.mock.calls[0][1]).toMatchObject({
        impersonate: "testing",
        curlOptions: { [CurlOpt.HTTP_VERSION]: CurlHttpVersion.CURL_HTTP_VERSION_3ONLY },
        dohUrl: "https://cloudflare-dns.com/dns-query",
        timeout: 60,
      });
    } finally {
      await session.close();
    }
  });

  it("reports request context and the native error buffer without logging API headers", async () => {
    const cause = new Error("certificate verification failed");
    jest.spyOn(Session.prototype, "get").mockImplementation(async (_url, options) => {
      const buffer = options?.curlOptions?.[CurlOpt.ERRORBUFFER] as Buffer;
      buffer.write("unable to get local issuer certificate\0ignored trailing bytes");
      throw cause;
    });
    const session = new Session();
    try {
      await expect(requestJson(session, "https://capture.test", {
        impersonate: "testing", http3: true, apiKey: "secret-test-key",
      })).rejects.toMatchObject({
        cause,
        message: "Request failed: target=testing url=https://capture.test http3=true " +
          "doh=https://cloudflare-dns.com/dns-query\ncertificate verification failed\n" +
          "libcurl: unable to get local issuer certificate",
      });
    } finally {
      await session.close();
    }
  });

  it("reads error details written by the native library", async () => {
    const session = new Session();
    try {
      await expect(requestJson(session, "unsupported://example.test"))
        .rejects.toThrow(/libcurl: .*unsupported/i);
    } finally {
      await session.close();
    }
  });

  it("rejects a non-HTTP/3 capture before comparing fingerprints", async () => {
    jest.spyOn(Session.prototype, "get").mockResolvedValue(jsonResponse({}));
    const session = new Session();
    try {
      await expect(requestJson(session, "https://capture.test", { http3: true }))
        .rejects.toThrow("Expected HTTP/3");
    } finally {
      await session.close();
    }
  });

  liveTest("test_live_fingerprint_data_matches_runtime_output", async () => {
    const apiKey = process.env.IMPERSONATE_API_KEY!;
    const { apiRoot, fingerprints, sources } = await prepareLiveFingerprints(apiKey);
    const presetTargets = new Set(
      NATIVE_IMPERSONATE_TARGETS.map((target) => target.target_name)
    );
    const customTargets = Object.keys(fingerprints)
      .filter((target) => !presetTargets.has(target))
      .sort();
    await verifyTargets(customTargets, fingerprints, apiRoot, apiKey, false, sources);
  }, LIVE_TEST_TIMEOUT_MS);

  liveTest("test_live_http3_fingerprint_data_matches_runtime_output", async () => {
    const apiKey = process.env.IMPERSONATE_API_KEY!;
    const { apiRoot, fingerprints, sources } = await prepareLiveFingerprints(apiKey);
    const presetTargets = new Set(
      NATIVE_IMPERSONATE_TARGETS.map((target) => target.target_name)
    );
    const customHttp3Targets = Object.entries(fingerprints)
      .filter(([target, fingerprint]) =>
        !presetTargets.has(target) && Boolean(fingerprint.http3_settings)
      )
      .map(([target]) => target)
      .sort();
    await verifyTargets(customHttp3Targets, fingerprints, apiRoot, apiKey, true, sources);
  }, LIVE_TEST_TIMEOUT_MS);
});
