/**
 * Low-level Curl handle usage example
 */
import { Curl, CurlOpt } from "impers";

async function main() {
  const curl = new Curl();
  const chunks: Buffer[] = [];

  try {
    // Configure the request
    curl.setOpt(CurlOpt.URL, "https://example.com");

    // Set up write callback to collect response data
    curl.setWriteFunction((chunk) => {
      chunks.push(Buffer.from(chunk));
    });

    // Perform synchronous request
    curl.perform();

    // Output the response
    const body = Buffer.concat(chunks).toString();
    console.log("Response length:", body.length);
    console.log("First 200 chars:", body.substring(0, 200));
  } finally {
    curl.cleanup();
  }
}

main().catch(console.error);
