import {
  LIBCURL_IMPERSONATE_RELEASE_URL,
  LIBCURL_IMPERSONATE_VERSION,
} from "../src/ffi/loader.js";

describe("libcurl loader", () => {
  it("pins the curl-impersonate release", () => {
    expect(LIBCURL_IMPERSONATE_VERSION).toBe("v2.0.0");
    expect(LIBCURL_IMPERSONATE_RELEASE_URL).toBe(
      "https://api.github.com/repos/lexiforest/curl-impersonate/releases/tags/v2.0.0"
    );
  });
});
