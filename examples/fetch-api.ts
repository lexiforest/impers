/**
 * Fetch API example - using the standard `fetch()` with impers impersonation
 */
import { fetch } from "impers";

async function main() {
  // Standard Fetch API usage
  const res = await fetch("https://httpbin.org/get");
  console.log("Status:", res.status);
  console.log("Content-Type:", res.headers.get("content-type"));
  const json = await res.json();
  console.log("URL echoed:", (json as { url: string }).url);

  // POST with JSON body
  const postRes = await fetch("https://httpbin.org/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
  console.log("POST status:", postRes.status);
  console.log("Echoed body:", await postRes.text());

  // impers extension: browser impersonation via standard fetch init
  const fp = await fetch("https://tls.browserleaks.com/json", {
    impersonate: "chrome142",
  } as never);
  console.log("Fingerprint status:", fp.status);
  console.log(await fp.text());
}

main().catch(console.error);