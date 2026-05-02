import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import https from "node:https";
import { gunzipSync, inflateRawSync } from "node:zlib";

export interface LibraryInfo {
  path: string;
  isImpersonate: boolean;
}

/**
 * Common locations to search for libcurl-impersonate
 */
const IMPERSONATE_SEARCH_PATHS: Record<string, string[]> = {
  darwin: [
    "/usr/local/lib/libcurl-impersonate.dylib",
    "/opt/homebrew/lib/libcurl-impersonate.dylib",
    "/usr/local/opt/curl-impersonate/lib/libcurl-impersonate.dylib",
    "/opt/homebrew/opt/curl-impersonate/lib/libcurl-impersonate.dylib",
  ],
  linux: [
    "/usr/local/lib/libcurl-impersonate.so",
    "/usr/lib/libcurl-impersonate.so",
    "/usr/lib/x86_64-linux-gnu/libcurl-impersonate.so",
    "/usr/lib/aarch64-linux-gnu/libcurl-impersonate.so",
  ],
  win32: [
    "C:\\curl-impersonate\\bin\\libcurl-impersonate.dll",
    "libcurl-impersonate.dll",
  ],
};

/**
 * Default system libcurl candidates per platform.
 * Prefer runtime sonames before development symlinks because CI images often
 * ship libcurl at a versioned path only (for example libcurl.so.4).
 */
const DEFAULT_LIBCURL_CANDIDATES: Record<string, string[]> = {
  darwin: ["libcurl.4.dylib", "libcurl.dylib"],
  linux: ["libcurl.so.4", "libcurl.so"],
  win32: ["libcurl.dll", "libcurl-x64.dll", "libcurl-x86.dll"],
};

const SYSTEM_LIBCURL_SEARCH_PATHS: Record<string, string[]> = {
  darwin: [
    "/usr/lib",
    "/usr/local/lib",
    "/opt/homebrew/lib",
    "/opt/local/lib",
  ],
  linux: [
    "/usr/local/lib",
    "/usr/local/lib64",
    "/usr/lib",
    "/usr/lib64",
    "/lib",
    "/lib64",
  ],
  win32: [],
};

const LIB_PREFIX = "libcurl-impersonate";
const CACHE_LOCK_POLL_MS = 100;
const CACHE_LOCK_STALE_MS = 5 * 60 * 1000;
const CACHE_LOCK_TIMEOUT_MS = 3 * 60 * 1000;
const PLATFORM_LIB_EXT: Record<string, string> = {
  darwin: ".dylib",
  linux: ".so",
  win32: ".dll",
};

/**
 * Find the first existing path from a list
 */
function findExistingPath(paths: string[]): string | null {
  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

function isNonEmptyFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function getCacheRoot(): string | null {
  if (process.env.IMPER_CACHE_DIR) {
    return process.env.IMPER_CACHE_DIR;
  }

  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA;
    return base ? join(base, "impers", "libcurl-impersonate") : null;
  }

  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "impers", "libcurl-impersonate");
}

function getCacheDir(cacheRoot: string, platform: string, arch: string): string {
  return join(cacheRoot, `${platform}-${arch}`);
}

function getCacheLockDir(cacheRoot: string, platform: string, arch: string): string {
  return join(cacheRoot, `${platform}-${arch}.lock`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCacheLock<T>(
  cacheRoot: string,
  platform: string,
  arch: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockDir = getCacheLockDir(cacheRoot, platform, arch);
  const started = Date.now();
  let locked = false;

  while (!locked) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "owner"), `${process.pid}\n`);
      locked = true;
    } catch {
      let stale = false;
      try {
        stale = Date.now() - statSync(lockDir).mtimeMs > CACHE_LOCK_STALE_MS;
      } catch {
        stale = false;
      }

      if (stale) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - started > CACHE_LOCK_TIMEOUT_MS) {
        throw new Error("Timed out waiting for libcurl cache lock");
      }

      await sleep(CACHE_LOCK_POLL_MS);
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

function splitEnvPaths(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
}

function getSystemSearchPaths(platform: string, arch: string): string[] {
  const paths = [...(SYSTEM_LIBCURL_SEARCH_PATHS[platform] || [])];

  if (platform === "linux") {
    const archDirs = arch === "x64"
      ? ["/usr/lib/x86_64-linux-gnu", "/lib/x86_64-linux-gnu"]
      : arch === "arm64"
      ? ["/usr/lib/aarch64-linux-gnu", "/lib/aarch64-linux-gnu"]
      : [];
    paths.unshift(...archDirs);
    paths.unshift(...splitEnvPaths(process.env.LD_LIBRARY_PATH));
  } else if (platform === "darwin") {
    paths.unshift(...splitEnvPaths(process.env.DYLD_LIBRARY_PATH));
    paths.unshift(...splitEnvPaths(process.env.LD_LIBRARY_PATH));
  } else if (platform === "win32") {
    paths.unshift(...splitEnvPaths(process.env.PATH));
  }

  return uniquePaths(paths);
}

function findLibraryInPaths(paths: string[], candidates: string[]): string | null {
  for (const dir of paths) {
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (isNonEmptyFile(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function findVersionedSystemLibrary(paths: string[], platform: string): string | null {
  const libExt = PLATFORM_LIB_EXT[platform] || ".so";
  const matches: string[] = [];

  for (const dir of paths) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!isLibName(entry, "libcurl", libExt) || entry.includes("impersonate")) {
        continue;
      }

      const fullPath = join(dir, entry);
      if (isNonEmptyFile(fullPath)) {
        matches.push(fullPath);
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => basename(a).length - basename(b).length);
  return matches[0] || null;
}

function findSystemLibrary(platform: string, arch: string): string {
  const candidates = DEFAULT_LIBCURL_CANDIDATES[platform] || ["libcurl.so.4", "libcurl.so"];
  const searchPaths = getSystemSearchPaths(platform, arch);

  const discovered = findLibraryInPaths(searchPaths, candidates)
    || findVersionedSystemLibrary(searchPaths, platform);
  if (discovered) {
    return discovered;
  }

  // Fall back to a likely runtime soname so the dynamic linker still has a
  // chance to resolve it if it is on the default loader path.
  return candidates[0];
}

function collectLibraryCandidates(rootDir: string, libExt: string): string[] {
  const candidates: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (isLibName(entry, LIB_PREFIX, libExt)) {
        candidates.push(fullPath);
      }
    }
  }

  return candidates;
}

function findCachedLibrary(cacheRoot: string, platform: string, arch: string): string | null {
  const cacheDir = getCacheDir(cacheRoot, platform, arch);
  if (!existsSync(cacheDir)) {
    return null;
  }

  const libExt = PLATFORM_LIB_EXT[platform] || ".so";
  const candidates = collectLibraryCandidates(cacheDir, libExt);
  if (candidates.length === 0) {
    return null;
  }

  const exactName = `${LIB_PREFIX}${libExt}`;
  for (const candidate of candidates) {
    if (basename(candidate) === exactName && isNonEmptyFile(candidate)) {
      return candidate;
    }
  }

  const nonEmpty = candidates.filter((candidate) => isNonEmptyFile(candidate));
  nonEmpty.sort((a, b) => basename(a).length - basename(b).length);
  return nonEmpty[0] || null;
}

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type ExtractedEntry = {
  name: string;
  data?: Buffer;
  linkName?: string;
  type: "file" | "symlink";
};

async function tryDownloadImpersonate(platform: string, arch: string): Promise<string | null> {
  if (process.env.IMPER_DOWNLOAD_LIBCURL === "0") {
    return null;
  }

  const cacheRoot = getCacheRoot();
  if (!cacheRoot) {
    return null;
  }

  const cached = findCachedLibrary(cacheRoot, platform, arch);
  if (cached) {
    return cached;
  }

  mkdirSync(cacheRoot, { recursive: true });

  try {
    return await withCacheLock(cacheRoot, platform, arch, async () => {
      const cachedAfterLock = findCachedLibrary(cacheRoot, platform, arch);
      if (cachedAfterLock) {
        return cachedAfterLock;
      }
      return await downloadImpersonate(cacheRoot, platform, arch);
    });
  } catch {
    return findCachedLibrary(cacheRoot, platform, arch);
  }
}

async function downloadImpersonate(cacheRoot: string, platform: string, arch: string): Promise<string> {
  const libExt = PLATFORM_LIB_EXT[platform] || ".so";
  const targetDir = getCacheDir(cacheRoot, platform, arch);
  const apiUrl = process.env.IMPER_LIBCURL_RELEASE_URL ||
    "https://api.github.com/repos/lexiforest/curl-impersonate/releases/latest";
  const headers = {
    "User-Agent": "impers",
    "Accept": "application/vnd.github+json",
  };

  const release = await fetchJson(apiUrl, headers) as { assets?: ReleaseAsset[] };
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = pickAsset(assets, platform, arch);
  if (!asset || !asset.name || !asset.browser_download_url) {
    throw new Error("No suitable curl-impersonate release asset found");
  }

  const archive = await fetchBuffer(asset.browser_download_url, headers);
  const extracted = extractArchive(archive, asset.name, libExt);
  if (extracted.length === 0) {
    throw new Error("No libcurl-impersonate binary found in release asset");
  }

  mkdirSync(targetDir, { recursive: true });
  writeExtractedEntries(extracted, targetDir, platform);

  const resolved = findCachedLibrary(cacheRoot, platform, arch);
  if (!resolved) {
    throw new Error("Failed to locate libcurl-impersonate after extraction");
  }
  return resolved;
}

function sanitizeArchivePath(name: string): string | null {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((part) => part && part !== "." && part !== "..");
  if (parts.length === 0) {
    return null;
  }
  return parts.join("/");
}

function writeFileAtomic(outPath: string, data: Buffer): void {
  const tmpPath = `${outPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, outPath);
}

function writeExtractedEntries(entries: ExtractedEntry[], targetDir: string, platform: string): void {
  const symlinks: Array<{ outPath: string; linkName: string }> = [];

  for (const entry of entries) {
    const safePath = sanitizeArchivePath(entry.name);
    if (!safePath) {
      continue;
    }

    let relativePath = safePath;
    if (platform === "win32") {
      if (!safePath.startsWith("bin/")) {
        continue;
      }
      relativePath = safePath.slice(4);
      relativePath = join("bin", relativePath);
    }

    const outPath = join(targetDir, relativePath);
    mkdirSync(dirname(outPath), { recursive: true });

    if (entry.type === "symlink") {
      if (platform !== "win32" && entry.linkName) {
        symlinks.push({ outPath, linkName: entry.linkName });
      }
      continue;
    }

    writeFileAtomic(outPath, entry.data ?? Buffer.alloc(0));
  }

  if (platform === "win32") {
    return;
  }

  for (const { outPath, linkName } of symlinks) {
    if (existsSync(outPath)) {
      continue;
    }
    try {
      symlinkSync(linkName, outPath);
    } catch {
      // Ignore symlink creation failures
    }
  }
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const data = await fetchBuffer(url, headers);
  return JSON.parse(data.toString("utf-8"));
}

function fetchBuffer(
  url: string,
  headers: Record<string, string>,
  redirectCount: number = 0
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectCount > 5) {
          reject(new Error("Too many redirects"));
          res.resume();
          return;
        }
        const nextUrl = res.headers.location;
        res.resume();
        resolve(fetchBuffer(nextUrl, headers, redirectCount + 1));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Request failed: ${res.statusCode ?? "unknown"}`));
        res.resume();
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });

    req.setTimeout(30000, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.on("error", reject);
  });
}

function pickAsset(assets: ReleaseAsset[], platform: string, arch: string): ReleaseAsset | null {
  const candidates = assets.filter((asset) =>
    asset &&
    typeof asset.name === "string" &&
    typeof asset.browser_download_url === "string"
  );

  const filtered = candidates.filter((asset) => {
    const name = asset.name!.toLowerCase();
    const hasArchiveExt = name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".tar") ||
      name.endsWith(".zip") || name.endsWith(".dylib") || name.endsWith(".dll") ||
      name.includes(".so");
    return name.startsWith("libcurl") && name.includes("impersonate") && hasArchiveExt;
  });

  const platformTokens = platform === "darwin"
    ? ["macos", "darwin", "osx", "mac"]
    : platform === "linux"
    ? ["linux"]
    : ["win", "windows"];
  const platformExcludes = platform === "linux"
    ? ["android"]
    : platform === "darwin"
    ? ["ios"]
    : [];
  const archTokens = arch === "arm64"
    ? ["arm64", "aarch64"]
    : arch === "x64"
    ? ["x86_64", "x64", "amd64"]
    : [arch];

  const matched = filtered.filter((asset) =>
    hasAnyToken(asset.name!, platformTokens) &&
    hasAnyToken(asset.name!, archTokens) &&
    !hasAnyToken(asset.name!, platformExcludes)
  );
  const platformMatched = matched.length > 0
    ? matched
    : filtered.filter((asset) =>
      hasAnyToken(asset.name!, platformTokens) &&
      !hasAnyToken(asset.name!, platformExcludes)
    );

  const abiMatched = platform === "linux"
    ? preferLinuxAbi(platformMatched)
    : platformMatched;
  const pool = abiMatched.length > 0 ? abiMatched : filtered;

  pool.sort((a, b) => rankByExt(a.name!, platform) - rankByExt(b.name!, platform));
  return pool[0] || null;
}

function preferLinuxAbi(assets: ReleaseAsset[]): ReleaseAsset[] {
  const libc = getLinuxLibc();
  const preferredAbi = libc === "musl" ? "linux-musl" : "linux-gnu";
  const preferred = assets.filter((asset) => asset.name!.toLowerCase().includes(preferredAbi));
  if (preferred.length > 0) {
    return preferred;
  }

  const gnuOrMusl = assets.filter((asset) => {
    const name = asset.name!.toLowerCase();
    return name.includes("linux-gnu") || name.includes("linux-musl");
  });
  return gnuOrMusl.length > 0 ? gnuOrMusl : assets;
}

function getLinuxLibc(): "gnu" | "musl" | null {
  if (process.platform !== "linux") {
    return null;
  }

  const report = process.report?.getReport() as {
    header?: { glibcVersionRuntime?: string };
  } | undefined;
  if (report?.header?.glibcVersionRuntime) {
    return "gnu";
  }

  return "musl";
}

function rankByExt(name: string, platform: string): number {
  const lower = name.toLowerCase();
  const win = platform === "win32";
  const preferences = win
    ? [".zip", ".dll", ".tar.gz", ".tgz", ".tar"]
    : [".tar.gz", ".tgz", ".tar", ".so", ".dylib", ".zip"];
  const idx = preferences.findIndex((ext) => lower.endsWith(ext));
  return idx === -1 ? 999 : idx;
}

function hasAnyToken(name: string, tokens: string[]): boolean {
  const lower = name.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

function extractArchive(
  buffer: Buffer,
  assetName: string,
  libExt: string
): ExtractedEntry[] {
  const lower = assetName.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return extractFromTar(gunzipSync(buffer));
  }
  if (lower.endsWith(".tar")) {
    return extractFromTar(buffer);
  }
  if (lower.endsWith(".zip")) {
    return extractFromZip(buffer);
  }
  if (libExt === ".so" && lower.includes(".so")) {
    return [{ name: basename(assetName), data: buffer, type: "file" }];
  }
  if (lower.endsWith(libExt)) {
    return [{ name: basename(assetName), data: buffer, type: "file" }];
  }
  return [];
}

function extractFromTar(buffer: Buffer): ExtractedEntry[] {
  const entries: ExtractedEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    const nameRaw = header.toString("utf-8", 0, 100).replace(/\0.*$/, "");
    const prefix = header.toString("utf-8", 345, 500).replace(/\0.*$/, "");
    if (!nameRaw && !prefix) {
      break;
    }

    const sizeRaw = header.toString("utf-8", 124, 136).replace(/\0.*$/, "").trim();
    const size = sizeRaw ? parseInt(sizeRaw, 8) : 0;
    if (!Number.isFinite(size)) {
      break;
    }

    const typeFlag = header[156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) {
      break;
    }

    const name = prefix ? `${prefix}/${nameRaw}` : nameRaw;
    if (name) {
      if (typeFlag === 50) {
        const linkName = header.toString("utf-8", 157, 257).replace(/\0.*$/, "");
        entries.push({ name, linkName, type: "symlink" });
      } else if (typeFlag === 0 || typeFlag === 48) {
        const data = buffer.subarray(dataStart, dataEnd);
        entries.push({ name, data, type: "file" });
      }
    }

    const paddedSize = Math.ceil(size / 512) * 512;
    offset = dataStart + paddedSize;
  }

  return entries;
}

function extractFromZip(buffer: Buffer): ExtractedEntry[] {
  const entries: ExtractedEntry[] = [];
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) {
      break;
    }

    const flags = buffer.readUInt16LE(offset + 6);
    if (flags & 0x08) {
      throw new Error("Unsupported zip format (data descriptor)");
    }
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLen;
    const fileName = buffer.toString("utf-8", nameStart, nameEnd);
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buffer.length) {
      break;
    }
    if (fileName.endsWith("/")) {
      offset = dataEnd;
      continue;
    }

    let data: Buffer | null = buffer.subarray(dataStart, dataEnd);
    if (method === 0) {
      // stored
    } else if (method === 8) {
      data = inflateRawSync(data);
    } else {
      data = null;
    }

    if (data) {
      entries.push({ name: fileName, data, type: "file" });
    }

    offset = dataEnd;
  }

  return entries;
}

function isLibName(name: string, libPrefix: string, libExt: string): boolean {
  const base = basename(name);
  if (!base.startsWith(libPrefix)) {
    return false;
  }
  if (libExt === ".so") {
    return base.includes(".so");
  }
  return base.endsWith(libExt);
}

/**
 * Resolve libcurl library path with priority:
 * 1. LIBCURL_IMPERSONATE_PATH env var (for curl-impersonate)
 * 2. LIBCURL_PATH env var (explicit path)
 * 3. Auto-detect curl-impersonate in common locations
 * 4. Download curl-impersonate into cache (optional)
 * 5. System libcurl
 */
export async function resolveLibrary(): Promise<LibraryInfo> {
  const platform = process.platform;
  const arch = process.arch;

  // Priority 1: Explicit curl-impersonate path
  if (process.env.LIBCURL_IMPERSONATE_PATH) {
    return {
      path: process.env.LIBCURL_IMPERSONATE_PATH,
      isImpersonate: true,
    };
  }

  // Priority 2: Explicit libcurl path (could be either)
  if (process.env.LIBCURL_PATH) {
    const path = process.env.LIBCURL_PATH;
    // Heuristic: if path contains "impersonate", assume it's curl-impersonate
    const isImpersonate = path.toLowerCase().includes("impersonate");
    return { path, isImpersonate };
  }

  // Priority 3: Auto-detect curl-impersonate
  const searchPaths = IMPERSONATE_SEARCH_PATHS[platform] || [];
  const impersonatePath = findExistingPath(searchPaths);
  if (impersonatePath) {
    return {
      path: impersonatePath,
      isImpersonate: true,
    };
  }

  const downloadedPath = await tryDownloadImpersonate(platform, arch);
  if (downloadedPath) {
    return {
      path: downloadedPath,
      isImpersonate: true,
    };
  }

  // Priority 5: System libcurl
  const defaultLib = findSystemLibrary(platform, arch);
  return {
    path: defaultLib,
    isImpersonate: false,
  };
}

/**
 * Get just the library path
 */
export async function resolveLibcurlPath(): Promise<string> {
  return (await resolveLibrary()).path;
}

/**
 * Check if we're using curl-impersonate
 */
export async function isUsingImpersonate(): Promise<boolean> {
  return (await resolveLibrary()).isImpersonate;
}

/**
 * Get platform information
 */
export function getPlatformInfo(): {
  platform: string;
  arch: string;
  isAppleSilicon: boolean;
} {
  return {
    platform: process.platform,
    arch: process.arch,
    isAppleSilicon: process.platform === "darwin" && process.arch === "arm64",
  };
}
