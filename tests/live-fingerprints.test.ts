import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FingerprintManager,
  NATIVE_IMPERSONATE_TARGETS,
  type Fingerprint,
} from "../src/fingerprints.js";
import { Session } from "../src/http/session.js";

const TLS_PEET_URL = "https://peet.impersonate.pro/api/all";
const PING_FP_URL = "https://fp.impersonate.pro/api/auto";
const IGNORED_JA3_EXTENSIONS = new Set(["21", "41", "45"]);
const EXPECTED_LABEL = "expected (API fingerprint)";
const CAPTURED_LABEL = "captured (runtime output)";
const LIVE_TEST_TIMEOUT_MS = 30 * 60 * 1000;

type JsonRecord = Record<string, unknown>;
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
  const response = await session.get(url, {
    headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
    impersonate: options.impersonate,
    httpVersion: options.http3 ? "3" : undefined,
    timeout: 30,
  });
  if (response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode} from ${url}: ${response.text}`);
  }
  return response.json();
}

async function loadRawFingerprint(
  session: Session,
  target: string,
  apiRoot: string,
  protocol: "http2" | "http3",
  apiKey: string
): Promise<JsonRecord> {
  const url = new URL(`${apiRoot.replace(/\/+$/, "")}/raw`);
  url.searchParams.set("name", target);
  url.searchParams.set("protocol", protocol);

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
}> {
  FingerprintManager.setApiKey(apiKey);
  const updated = await FingerprintManager.updateFingerprints();
  expect(updated).toBeGreaterThan(0);
  const fingerprints = FingerprintManager.loadFingerprints();
  expect(Object.keys(fingerprints).length).toBeGreaterThan(0);
  return { apiRoot: FingerprintManager.getApiRoot(), fingerprints };
}

async function verifyTargets(
  targets: string[],
  fingerprints: Record<string, Fingerprint>,
  apiRoot: string,
  apiKey: string,
  forceHttp3: boolean
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
        apiKey
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

  beforeEach(() => {
    previousConfigDir = process.env.IMPERSONATE_CONFIG_DIR;
    configDir = mkdtempSync(join(tmpdir(), "impers-live-fingerprints-"));
    process.env.IMPERSONATE_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (previousConfigDir === undefined) {
      delete process.env.IMPERSONATE_CONFIG_DIR;
    } else {
      process.env.IMPERSONATE_CONFIG_DIR = previousConfigDir;
    }
    rmSync(configDir, { recursive: true, force: true });
  });

  liveTest("test_live_fingerprint_data_matches_runtime_output", async () => {
    const apiKey = process.env.IMPERSONATE_API_KEY!;
    const { apiRoot, fingerprints } = await prepareLiveFingerprints(apiKey);
    const presetTargets = new Set(
      NATIVE_IMPERSONATE_TARGETS.map((target) => target.target_name)
    );
    const customTargets = Object.keys(fingerprints)
      .filter((target) => !presetTargets.has(target))
      .sort();
    await verifyTargets(customTargets, fingerprints, apiRoot, apiKey, false);
  }, LIVE_TEST_TIMEOUT_MS);

  liveTest("test_live_http3_fingerprint_data_matches_runtime_output", async () => {
    const apiKey = process.env.IMPERSONATE_API_KEY!;
    const { apiRoot, fingerprints } = await prepareLiveFingerprints(apiKey);
    const presetTargets = new Set(
      NATIVE_IMPERSONATE_TARGETS.map((target) => target.target_name)
    );
    const customHttp3Targets = Object.entries(fingerprints)
      .filter(([target, fingerprint]) =>
        !presetTargets.has(target) && Boolean(fingerprint.http3_settings)
      )
      .map(([target]) => target)
      .sort();
    await verifyTargets(customHttp3Targets, fingerprints, apiRoot, apiKey, true);
  }, LIVE_TEST_TIMEOUT_MS);
});
