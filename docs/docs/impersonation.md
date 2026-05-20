---
title: Supported Impersonate Browsers
sidebar_label: Impersonation
---

# Supported Impersonate Browsers

`curl_cffi` supports the same browser versions preset as supported by our [fork](https://github.com/lexiforest/curl-impersonate) of [curl-impersonate](https://github.com/lwthiker/curl-impersonate):

The open source version of `impers` includes versions when we are adding new capabilities for impersonating.
If you see a version, e.g. `chrome135`, was skipped, it's simply because there's nothing new or we were busy at that time. 
You can simply impersonate it with your own headers and the previous browser target.

For a full list of preset fingerprints, see the [curl-impersonate docs](https://curl-impersonate.readthedocs.io/en/latest/fingerprints.html). 
We will no longer put duplicated and outdated info here.

If you don't want to look up the headers/etc by yourself, consider buying commercial support from [impersonate.pro](https://impersonate.pro).
We have comprehensive browser tls, http and JavaScript fingerprints database for almost all the browser versions on various platforms.

The commercial support in `impers` is still under construction.



If you are trying to impersonate a target other than a browser, use `ja3` and `akamai` options to specify your own customized fingerprints — see [Custom Fingerprints](./custom-fingerprints).
