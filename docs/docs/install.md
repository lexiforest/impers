---
title: Install
sidebar_label: Install
---

# Install

```bash
npm install impers
```

## Requirements

**libcurl-impersonate**: For full fingerprinting support, you need [curl-impersonate](https://github.com/lexiforest/curl-impersonate) installed. Standard libcurl works but without impersonation features.

If no local curl-impersonate library is found, `impers` downloads the pinned
curl-impersonate **2.3.1** release (curl **8.23.0**) at first launch and caches it
by version. The current profiles and WebSocket compression require 2.3.0 or later.

If you wish to use your own version, set the `LIBCURL_PATH` environment variable:

```bash
export LIBCURL_PATH=/path/to/libcurl-impersonate.so
```
