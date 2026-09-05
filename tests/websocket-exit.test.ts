/**
 * The process must exit cleanly after a WebSocket has been opened.
 *
 * This is a child-process test on purpose. The failure it guards against happens *after*
 * the script finishes — libcurl driven from a libuv worker thread leaves per-thread state
 * whose pthread TSD destructor lives in the libcurl image, and at exit the worker thread is
 * torn down and calls that destructor after the image has gone. The script produces its
 * output, then the process dies with SIGSEGV. Nothing observable from inside the process
 * can catch that; only the exit status can.
 */
import { spawn } from "node:child_process";
import { getWebSocketUrl } from "./mock-server.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const builtEntry = `${repositoryRoot}dist/index.js`;

/**
 * Run a snippet in a fresh Node process and report how it terminated.
 *
 * Asynchronous on purpose: the mock server this connects to lives in *this* process, so a
 * blocking `spawnSync` would stop it answering and the child would hang.
 */
function runInChild(source: string): Promise<{ status: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (status, signal) => {
      if (process.env.IMPERS_DEBUG_TESTS) {
        console.log("child:", JSON.stringify({ status, signal, stderr: stderr.slice(0, 600) }));
      }
      resolve({ status, signal });
    });
  });
}

describe("process exit after WebSocket use", () => {
  // The child cannot run the TypeScript sources — they use NodeNext `.js` specifiers, which
  // Node's type stripping does not resolve — so it imports the build. Built here rather than
  // assumed present: a stale `dist/` would let this test pass against the very code it
  // exists to reject.
  beforeAll(async () => {
    const build = spawn("npm", ["run", "build"], { cwd: repositoryRoot, stdio: "ignore" });
    const code = await new Promise<number | null>((resolve) => build.on("close", resolve));
    if (code !== 0) throw new Error(`npm run build exited with ${code}`);
  }, 300_000);

  it.each([
    ["closed before exiting", true],
    ["left open at exit", false],
  ])("exits cleanly with the socket %s", async (_label, closeFirst) => {
    const source = `
      const { wsConnect } = await import(${JSON.stringify(builtEntry)});
      const ws = await wsConnect(${JSON.stringify(`${getWebSocketUrl()}/ws/echo`)});
      ${closeFirst ? "await ws.close();" : ""}
    `;

    const { status, signal } = await runInChild(source);

    // A segfault surfaces as signal SIGSEGV, or as status 139 when a shell is involved.
    expect(signal).toBeNull();
    expect(status).toBe(0);
  });
});
