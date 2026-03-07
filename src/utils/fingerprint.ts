/**
 * TLS/HTTP2 Fingerprinting utilities
 *
 * Provides support for JA3, Akamai, and custom fingerprint configuration
 * when using curl-impersonate.
 */

import { Curl } from "../core/easy.js";
import {
  CurlOpt,
  CurlSslVersion,
  CurlHttpVersion,
  CurlImpersonateOpt,
} from "../ffi/constants.js";
import type { ExtraFingerprint } from "../types/options.js";

/**
 * TLS version mapping from JA3 hex codes to curl SSL version constants
 */
export const TLS_VERSION_MAP: Record<number, number> = {
  0x0301: CurlSslVersion.CURL_SSLVERSION_TLSv1_0, // 769
  0x0302: CurlSslVersion.CURL_SSLVERSION_TLSv1_1, // 770
  0x0303: CurlSslVersion.CURL_SSLVERSION_TLSv1_2, // 771
  0x0304: CurlSslVersion.CURL_SSLVERSION_TLSv1_3, // 772
};

/**
 * TLS cipher suite ID to name mapping
 * Based on IANA TLS parameters: http://www.iana.org/assignments/tls-parameters/tls-parameters.xml
 */
export const TLS_CIPHER_NAME_MAP: Record<number, string> = {
  0x000a: "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
  0x002f: "TLS_RSA_WITH_AES_128_CBC_SHA",
  0x0033: "TLS_DHE_RSA_WITH_AES_128_CBC_SHA",
  0x0035: "TLS_RSA_WITH_AES_256_CBC_SHA",
  0x0039: "TLS_DHE_RSA_WITH_AES_256_CBC_SHA",
  0x003c: "TLS_RSA_WITH_AES_128_CBC_SHA256",
  0x003d: "TLS_RSA_WITH_AES_256_CBC_SHA256",
  0x0067: "TLS_DHE_RSA_WITH_AES_128_CBC_SHA256",
  0x006b: "TLS_DHE_RSA_WITH_AES_256_CBC_SHA256",
  0x008c: "TLS_PSK_WITH_AES_128_CBC_SHA",
  0x008d: "TLS_PSK_WITH_AES_256_CBC_SHA",
  0x009c: "TLS_RSA_WITH_AES_128_GCM_SHA256",
  0x009d: "TLS_RSA_WITH_AES_256_GCM_SHA384",
  0x009e: "TLS_DHE_RSA_WITH_AES_128_GCM_SHA256",
  0x009f: "TLS_DHE_RSA_WITH_AES_256_GCM_SHA384",
  0x1301: "TLS_AES_128_GCM_SHA256",
  0x1302: "TLS_AES_256_GCM_SHA384",
  0x1303: "TLS_CHACHA20_POLY1305_SHA256",
  0xc008: "TLS_ECDHE_ECDSA_WITH_3DES_EDE_CBC_SHA",
  0xc009: "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
  0xc00a: "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA",
  0xc012: "TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA",
  0xc013: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
  0xc014: "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
  0xc023: "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256",
  0xc024: "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA384",
  0xc027: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
  0xc028: "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384",
  0xc02b: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
  0xc02c: "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
  0xc02f: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
  0xc030: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
  0xc035: "TLS_ECDHE_PSK_WITH_AES_128_CBC_SHA",
  0xc036: "TLS_ECDHE_PSK_WITH_AES_256_CBC_SHA",
  0xcca8: "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
  0xcca9: "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
  0xccac: "TLS_ECDHE_PSK_WITH_CHACHA20_POLY1305_SHA256",
};

/**
 * TLS elliptic curve ID to name mapping
 */
export const TLS_EC_CURVES_MAP: Record<number, string> = {
  19: "P-192",
  21: "P-224",
  23: "P-256",
  24: "P-384",
  25: "P-521",
  29: "X25519",
  256: "ffdhe2048",
  257: "ffdhe3072",
  4588: "X25519MLKEM768",
  25497: "X25519Kyber768Draft00",
};

/**
 * TLS extension ID to name mapping (for reference/debugging)
 */
export const TLS_EXTENSION_NAME_MAP: Record<number, string> = {
  0: "server_name",
  5: "status_request",
  10: "supported_groups",
  11: "ec_point_formats",
  13: "signature_algorithms",
  16: "application_layer_protocol_negotiation",
  18: "signed_certificate_timestamp",
  21: "padding",
  23: "extended_master_secret",
  27: "compress_certificate",
  28: "record_size_limit",
  34: "delegated_credential",
  35: "session_ticket",
  43: "supported_versions",
  45: "psk_key_exchange_modes",
  51: "key_share",
  17513: "application_settings",
  17613: "application_settings_new",
  65037: "encrypted_client_hello",
  65281: "renegotiation_info",
};

/**
 * Error thrown when fingerprint configuration fails
 */
export class FingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FingerprintError";
  }
}

/**
 * Parse and apply JA3 fingerprint string to a curl handle
 *
 * JA3 format: tls_version,ciphers,extensions,curves,curve_formats
 * Example: 771,4865-4866-4867-49195-49199,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0
 *
 * @param curl - The Curl instance to configure
 * @param ja3 - JA3 fingerprint string
 * @param permute - If true, don't set extension order (allows random permutation)
 */
export function setJa3Options(curl: Curl, ja3: string, permute: boolean = false): void {
  const parts = ja3.split(",");
  if (parts.length !== 5) {
    throw new FingerprintError(
      `Invalid JA3 format: expected 5 comma-separated parts, got ${parts.length}`
    );
  }

  const [tlsVersion, ciphers, extensions, curves, curveFormats] = parts;

  // Set TLS version
  const tlsVersionNum = parseInt(tlsVersion, 10);
  const curlTlsVersion = TLS_VERSION_MAP[tlsVersionNum];
  if (!curlTlsVersion) {
    throw new FingerprintError(`Unknown TLS version: ${tlsVersion} (0x${tlsVersionNum.toString(16)})`);
  }
  // Combine with MAX_DEFAULT to allow negotiation up to the highest supported version
  curl.setOpt(CurlOpt.SSLVERSION, curlTlsVersion | CurlSslVersion.CURL_SSLVERSION_MAX_DEFAULT);

  // Set cipher suites
  const cipherNames: string[] = [];
  for (const cipher of ciphers.split("-")) {
    if (!cipher) continue;
    const cipherId = parseInt(cipher, 10);
    // Skip GREASE values (0x?a?a pattern)
    if (isGrease(cipherId)) continue;
    const cipherName = TLS_CIPHER_NAME_MAP[cipherId];
    if (!cipherName) {
      throw new FingerprintError(`Unknown cipher: ${cipher} (0x${cipherId.toString(16)})`);
    }
    cipherNames.push(cipherName);
  }
  if (cipherNames.length > 0) {
    curl.setOpt(CurlOpt.SSL_CIPHER_LIST, cipherNames.join(":"));
  }

  // Process extensions
  let extensionStr = extensions;
  // Remove trailing padding extension (21) - managed by SSL engine
  if (extensionStr.endsWith("-21")) {
    extensionStr = extensionStr.slice(0, -3);
  }

  const extensionIds = new Set<number>();
  for (const ext of extensionStr.split("-")) {
    if (!ext) continue;
    const extId = parseInt(ext, 10);
    // Skip GREASE values
    if (!isGrease(extId)) {
      extensionIds.add(extId);
    }
  }

  // Toggle extensions based on which ones are present
  toggleExtensionsByIds(curl, extensionIds);

  // Set extension order if not permuting
  if (!permute && extensionStr) {
    curl.setOpt(CurlImpersonateOpt.CURLOPT_TLS_EXTENSION_ORDER, extensionStr);
  }

  // Set elliptic curves
  const curveNames: string[] = [];
  for (const curve of curves.split("-")) {
    if (!curve) continue;
    const curveId = parseInt(curve, 10);
    // Skip GREASE values
    if (isGrease(curveId)) continue;
    const curveName = TLS_EC_CURVES_MAP[curveId];
    if (!curveName) {
      throw new FingerprintError(`Unknown curve: ${curve} (ID: ${curveId})`);
    }
    curveNames.push(curveName);
  }
  if (curveNames.length > 0) {
    curl.setOpt(CurlOpt.SSL_EC_CURVES, curveNames.join(":"));
  }

  // Verify curve formats (only 0 is supported)
  const curveFormatNum = parseInt(curveFormats, 10);
  if (curveFormatNum !== 0) {
    throw new FingerprintError(`Unsupported curve format: ${curveFormats} (only 0 is supported)`);
  }
}

/**
 * Parse and apply Akamai HTTP/2 fingerprint string to a curl handle
 *
 * Akamai format: settings|window_update|streams|header_order
 * Example: 1:65536;3:1000;4:6291456;6:262144|15663105|0|m,a,s,p
 *
 * @param curl - The Curl instance to configure
 * @param akamai - Akamai fingerprint string
 */
export function setAkamaiOptions(curl: Curl, akamai: string): void {
  const parts = akamai.split("|");
  if (parts.length !== 4) {
    throw new FingerprintError(
      `Invalid Akamai format: expected 4 pipe-separated parts, got ${parts.length}`
    );
  }

  const [settings, windowUpdate, streams, headerOrder] = parts;

  // Force HTTP/2
  curl.setOpt(CurlOpt.HTTP_VERSION, CurlHttpVersion.CURL_HTTP_VERSION_2_0);

  // Set HTTP/2 SETTINGS frame values
  // Convert comma format to semicolon format for libcurl compatibility
  const settingsStr = settings.replace(/,/g, ";");
  curl.setOpt(CurlImpersonateOpt.CURLOPT_HTTP2_SETTINGS, settingsStr);

  // Set window update value
  const windowUpdateNum = parseInt(windowUpdate, 10);
  curl.setOpt(CurlImpersonateOpt.CURLOPT_HTTP2_WINDOW_UPDATE, windowUpdateNum);

  // Set streams if not "0"
  if (streams !== "0") {
    curl.setOpt(CurlImpersonateOpt.CURLOPT_HTTP2_STREAMS, streams);
  }

  // Set pseudo header order (m,a,s,p -> masp)
  // curl-impersonate only accepts format without commas
  const headerOrderStr = headerOrder.replace(/,/g, "");
  curl.setOpt(CurlImpersonateOpt.CURLOPT_HTTP2_PSEUDO_HEADERS_ORDER, headerOrderStr);
}

/**
 * Apply ExtraFingerprint options to a curl handle
 *
 * @param curl - The Curl instance to configure
 * @param fp - Extra fingerprint options
 */
export function setExtraFingerprintOptions(curl: Curl, fp: ExtraFingerprint): void {
  // TLS signature algorithms
  if (fp.tlsSigAlgs && fp.tlsSigAlgs.length > 0) {
    curl.setOpt(CurlImpersonateOpt.CURLOPT_SSL_SIG_HASH_ALGS, fp.tlsSigAlgs.join(","));
  }

  // TLS extension order
  if (fp.tlsExtensionOrder && fp.tlsExtensionOrder.length > 0) {
    curl.setOpt(
      CurlImpersonateOpt.CURLOPT_TLS_EXTENSION_ORDER,
      fp.tlsExtensionOrder.join("-")
    );
  }

  // TLS supported groups (elliptic curves)
  if (fp.tlsSupportedGroups && fp.tlsSupportedGroups.length > 0) {
    curl.setOpt(CurlOpt.SSL_EC_CURVES, fp.tlsSupportedGroups.join(":"));
  }

  // HTTP/2 settings
  if (fp.http2Settings) {
    // Convert object to string format: "key:value;key:value"
    const settingsPairs = Object.entries(fp.http2Settings).map(
      ([key, value]) => `${key}:${value}`
    );
    curl.setOpt(CurlImpersonateOpt.CURLOPT_HTTP2_SETTINGS, settingsPairs.join(";"));
  }

  // HTTP/2 window update
  if (fp.http2WindowUpdate !== undefined) {
    curl.setOpt(CurlImpersonateOpt.CURLOPT_HTTP2_WINDOW_UPDATE, fp.http2WindowUpdate);
  }

  // HTTP/2 pseudo header order
  if (fp.http2PseudoHeaderOrder && fp.http2PseudoHeaderOrder.length > 0) {
    // Convert array to string: ["m", "a", "s", "p"] -> "masp"
    curl.setOpt(
      CurlImpersonateOpt.CURLOPT_HTTP2_PSEUDO_HEADERS_ORDER,
      fp.http2PseudoHeaderOrder.join("")
    );
  }

  // HTTP/2 connection flow
  if (fp.http2ConnectionFlow !== undefined) {
    curl.setOpt(CurlImpersonateOpt.CURLOPT_HTTP2_WINDOW_UPDATE, fp.http2ConnectionFlow);
  }
}

/**
 * Check if a value is a TLS GREASE value
 * GREASE values follow the pattern 0x?a?a (e.g., 0x0a0a, 0x1a1a, etc.)
 */
function isGrease(value: number): boolean {
  // GREASE values: 0x0a0a, 0x1a1a, 0x2a2a, 0x3a3a, 0x4a4a, 0x5a5a, 0x6a6a,
  // 0x7a7a, 0x8a8a, 0x9a9a, 0xaaaa, 0xbaba, 0xcaca, 0xdada, 0xeaea, 0xfafa
  if (value < 0x0a0a) return false;
  const high = (value >> 8) & 0xff;
  const low = value & 0xff;
  return high === low && (high & 0x0f) === 0x0a;
}

/**
 * Toggle TLS extensions based on which extension IDs are enabled
 */
function toggleExtensionsByIds(curl: Curl, enabledIds: Set<number>): void {
  // All known toggleable extensions
  const allToggleableExtensions = [
    5,      // status_request
    16,     // ALPN
    18,     // signed_certificate_timestamp
    27,     // compress_certificate
    35,     // session_ticket
    17513,  // application_settings (ALPS)
    17613,  // application_settings new (ALPS new codepoint)
    65037,  // encrypted_client_hello
  ];

  for (const extId of allToggleableExtensions) {
    const enable = enabledIds.has(extId);
    toggleExtension(curl, extId, enable);
  }
}

/**
 * Toggle a specific TLS extension on or off
 */
function toggleExtension(curl: Curl, extensionId: number, enable: boolean): void {
  switch (extensionId) {
    // ECH - Encrypted Client Hello
    case 65037:
      curl.setOpt(CurlOpt.ECH, enable ? "grease" : "");
      break;

    // Certificate compression
    case 27:
      curl.setOpt(
        CurlImpersonateOpt.CURLOPT_SSL_CERT_COMPRESSION,
        enable ? "brotli" : ""
      );
      break;

    // ALPS - Application Settings (old codepoint)
    case 17513:
      curl.setOpt(CurlImpersonateOpt.CURLOPT_SSL_ENABLE_ALPS, enable ? 1 : 0);
      break;

    // ALPS - Application Settings (new codepoint)
    case 17613:
      curl.setOpt(CurlImpersonateOpt.CURLOPT_SSL_ENABLE_ALPS, enable ? 1 : 0);
      curl.setOpt(CurlImpersonateOpt.CURLOPT_TLS_USE_NEW_ALPS_CODEPOINT, enable ? 1 : 0);
      break;

    // ALPN - Application Layer Protocol Negotiation
    case 16:
      curl.setOpt(CurlOpt.SSL_ENABLE_ALPN, enable ? 1 : 0);
      break;

    // OCSP Status Request
    case 5:
      curl.setOpt(CurlImpersonateOpt.CURLOPT_TLS_STATUS_REQUEST, enable ? 1 : 0);
      break;

    // Signed Certificate Timestamps
    case 18:
      curl.setOpt(CurlImpersonateOpt.CURLOPT_TLS_SIGNED_CERT_TIMESTAMPS, enable ? 1 : 0);
      break;

    // Session Ticket
    case 35:
      curl.setOpt(CurlImpersonateOpt.CURLOPT_SSL_ENABLE_TICKET, enable ? 1 : 0);
      break;

    // Padding extension (21) - managed by SSL engine, ignore
    case 21:
      break;

    // Delegated credentials (34) and record size limit (28) - handled by extra_fp
    case 34:
    case 28:
      break;

    default:
      // Unknown or unsupported extension - silently ignore
      break;
  }
}
