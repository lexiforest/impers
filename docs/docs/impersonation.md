---
title: Supported Impersonate Browsers
sidebar_label: Impersonation
---

# Supported Impersonate Browsers

`impers` supports the browser presets in [curl-impersonate 2.3.1](https://github.com/lexiforest/curl-impersonate/tree/v2.3.1).

The current aliases are `chrome` → `chrome152` (Windows), `firefox` →
`firefox155` (Windows), `safari` → `safari270` (macOS), and `safari_ios` →
`safari270_ios`. For Chrome on macOS, select `chrome151_macos` or
`chrome152_macos` explicitly. `safari_beta` and `safari_ios_beta` also select
the Safari 27.0 targets.

Chrome 145/146/150/151/152, their macOS variants, Firefox 147, and Safari 27.0
include dedicated HTTP/3 fingerprints. Firefox 153/154/155 include TLS and HTTP/2
fingerprints only. Set `httpVersion: "v3"` to allow HTTP/2 or HTTP/1.1 fallback,
or `httpVersion: "v3only"` to require HTTP/3:

```ts
const response = await impers.get("https://example.com", {
  impersonate: "chrome152_macos",
  httpVersion: "v3",
});
```

Native profiles choose their HTTP/3 or regular default headers after protocol
negotiation. Request headers override individual defaults on either protocol.

The open source version of `impers` includes versions when we are adding new capabilities for impersonating.
If you see a version, e.g. `chrome135`, was skipped, it's simply because there's nothing new or we were busy at that time. 
You can simply impersonate it with your own headers and the previous browser target.

For a full list of preset fingerprints, see the [curl-impersonate docs](https://curl-impersonate.readthedocs.io/en/latest/fingerprints.html). 
We will no longer put duplicated and outdated info here.

If you don't want to look up the headers/etc by yourself, consider buying commercial support from [impersonate.pro](https://impersonate.pro).
We have comprehensive browser tls, http and JavaScript fingerprints database for almost all the browser versions on various platforms.

## Fingerprint Command Line Tool

`impers` ships a small command line tool dedicated to managing fingerprint API access and the local fingerprint cache.
After installing the package, run:

```sh
npx impers --help
```

To save an impersonate.pro API key:

```sh
npx impers config --api-key imp_your_api_key
```

The API key is stored in `config.json` under the impersonate config directory. You can override the directory with `IMPERSONATE_CONFIG_DIR`, override the API root with `IMPERSONATE_API_ROOT`, or provide the key directly with `IMPERSONATE_API_KEY`.

To fetch the latest fingerprints into the local cache:

```sh
npx impers update
```

To view available builtin and cached fingerprints:

```sh
npx impers list
```

For machine-readable output:

```sh
npx impers list --json
```

Cached fingerprint names can be passed to the normal `impersonate` request option:

```ts
const response = await impers.get("https://example.com", {
  impersonate: "edge_146_macos_26",
});
```

Use `getFingerprint()` when you want an editable copy:

```ts
const fingerprint = impers.getFingerprint("edge_146_macos_26");
fingerprint.headers["User-Agent"] = "custom user agent";

const response = await impers.get("https://example.com", {
  impersonate: fingerprint,
});
```


If you are trying to impersonate a target other than a browser, use `ja3` and `akamai` options to specify your own customized fingerprints — see [Custom Fingerprints](./custom-fingerprints).
