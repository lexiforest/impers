import {
  LIBCURL_IMPERSONATE_RELEASE_URL,
  LIBCURL_IMPERSONATE_VERSION,
  writeExtractedEntries,
} from "../src/ffi/loader.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("libcurl loader", () => {
  it("pins the curl-impersonate release", () => {
    expect(LIBCURL_IMPERSONATE_VERSION).toBe("v2.1.1");
    expect(LIBCURL_IMPERSONATE_RELEASE_URL).toBe(
      "https://api.github.com/repos/lexiforest/curl-impersonate/releases/tags/v2.1.1"
    );
  });

  it.each(["lib", "bin"])(
    "extracts Windows libraries from the %s directory",
    (directory) => {
      const targetDir = mkdtempSync(join(tmpdir(), "impers-loader-"));
      const contents = Buffer.from("test dll");

      try {
        writeExtractedEntries(
          [{
            name: `${directory}/libcurl-impersonate.dll`,
            data: contents,
            type: "file",
          }],
          targetDir,
          "win32"
        );

        const extractedPath = join(
          targetDir,
          directory,
          "libcurl-impersonate.dll"
        );
        expect(existsSync(extractedPath)).toBe(true);
        expect(readFileSync(extractedPath)).toEqual(contents);
      } finally {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  );
});
