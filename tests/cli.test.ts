import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";

function createIo(): { stdout: string[]; stderr: string[]; io: Parameters<typeof runCli>[1] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
  };
}

function createEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    IMPERSONATE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "impers-cli-")),
  };
}

describe("impers CLI", () => {
  it("prints top-level help", async () => {
    const { stdout, stderr, io } = createIo();

    const code = await runCli(["--help"], io, createEnv());

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("\n")).toContain("Usage: impers <command> [options]");
    expect(stdout.join("\n")).toContain("update");
    expect(stdout.join("\n")).toContain("list");
    expect(stdout.join("\n")).toContain("config");
    expect(stdout.join("\n")).not.toContain("doctor");
  });

  it("stores an API key with config", async () => {
    const env = createEnv();
    const { stdout, stderr, io } = createIo();

    const code = await runCli(["config", "--api-key", "imp_test_key"], io, env);

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout[0]).toContain("API key saved to");

    const config = JSON.parse(readFileSync(join(env.IMPERSONATE_CONFIG_DIR!, "config.json"), "utf8")) as {
      api_key: string;
    };
    expect(config.api_key).toBe("imp_test_key");
  });

  it("rejects invalid API keys", async () => {
    const { stdout, stderr, io } = createIo();

    const code = await runCli(["config", "--api-key", "bad_key"], io, createEnv());

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(["API key must start with 'imp_'."]);
  });

  it("lists builtin fingerprints as JSON", async () => {
    const { stdout, stderr, io } = createIo();

    const code = await runCli(["list", "--json"], io, createEnv());

    expect(code).toBe(0);
    expect(stderr).toEqual([]);

    const rows = JSON.parse(stdout[0]) as Array<{ name: string; type: string }>;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "chrome120", type: "builtin" }),
        expect.objectContaining({ name: "firefox144", type: "builtin" }),
      ])
    );
  });

  it("updates fingerprints from the API", async () => {
    const env = createEnv();
    env.IMPERSONATE_API_ROOT = globalThis.TEST_SERVER_URL;
    env.IMPERSONATE_API_KEY = "imp_test_key";
    const { stdout, stderr, io } = createIo();

    const code = await runCli(["update"], io, env);

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual(["Total 2 fingerprints in cache."]);

    const fingerprints = JSON.parse(
      readFileSync(join(env.IMPERSONATE_CONFIG_DIR!, "fingerprints.json"), "utf8")
    ) as Record<string, { client: string; http_version: string }>;
    expect(fingerprints.edge_146_macos_26).toMatchObject({
      client: "edge",
      http_version: "v2",
    });
    expect(fingerprints.chrome_147_windows_10).toMatchObject({
      client: "chrome",
      http_version: "v3",
    });
  });
});
