#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { FingerprintManager, FingerprintUpdateError, type FingerprintRow } from "./fingerprints.js";

interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIO = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

const HELP = `Usage: impers <command> [options]

Fingerprint tools:
  update                           Update local fingerprints cache
  list [--json]                    List local and native fingerprints
  config --api-key <key>           Configure API access for Pro fingerprints

Run 'impers <command> --help' for details on a specific command.`;

const COMMAND_HELP: Record<string, string> = {
  update: `Usage: impers update

Update fingerprints from the impersonate API.`,
  list: `Usage: impers list [--json]

List local and native fingerprints.`,
  config: `Usage: impers config --api-key <key>

Set the API key for impersonate.pro.`,
};

function formatCell(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header) => header.length);
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index], cell.length);
    });
  }

  const renderRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index])).join(" | ");

  return [
    renderRow(headers),
    widths.map((width) => "-".repeat(width)).join("-+-"),
    ...rows.map(renderRow),
  ].join("\n");
}

function formatFingerprintTable(fingerprints: FingerprintRow[]): string {
  const headers = ["type", "name", "browser", "version", "os", "os_version", "h3_fingerprints"];
  const rows = fingerprints.map((fingerprint) =>
    headers.map((header) => formatCell(fingerprint[header as keyof FingerprintRow]))
  );
  return formatTable(headers, rows);
}

function parseOptionValue(args: string[], longName: string): string | null {
  const exactIndex = args.indexOf(longName);
  if (exactIndex !== -1) {
    return args[exactIndex + 1] || null;
  }

  const prefix = `${longName}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : null;
}

function validateApiKey(apiKey: string): void {
  if (!apiKey.startsWith("imp_")) {
    throw new Error("API key must start with 'imp_'.");
  }
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  io: CliIO = defaultIo,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    io.stdout(HELP);
    return 0;
  }

  if (args.includes("-h") || args.includes("--help")) {
    io.stdout(COMMAND_HELP[command] || HELP);
    return COMMAND_HELP[command] ? 0 : 1;
  }

  try {
    switch (command) {
      case "update": {
        const updated = await FingerprintManager.updateFingerprints(env);
        io.stdout(`Total ${updated} fingerprint${updated === 1 ? "" : "s"} in cache.`);
        return 0;
      }

      case "list": {
        const rows = FingerprintManager.listFingerprints(env);
        if (args.includes("--json")) {
          io.stdout(JSON.stringify(rows, null, 2));
        } else {
          io.stdout(formatFingerprintTable(rows));
        }
        return 0;
      }

      case "config": {
        const apiKey = parseOptionValue(args, "--api-key");
        if (!apiKey) {
          throw new Error("Missing required option: --api-key");
        }
        validateApiKey(apiKey);
        FingerprintManager.setApiKey(apiKey, env);
        io.stdout(`API key saved to ${FingerprintManager.getConfigPath(env)}`);
        return 0;
      }

      default:
        io.stderr(`Unknown command: ${command}`);
        io.stdout(HELP);
        return 1;
    }
  } catch (error) {
    if (error instanceof FingerprintUpdateError || error instanceof Error) {
      io.stderr(error.message);
    } else {
      io.stderr(String(error));
    }
    return 1;
  }
}

const invokedPath = process.argv[1] ? fileURLToPath(new URL(`file://${process.argv[1]}`)) : "";
const currentPath = fileURLToPath(import.meta.url);

if (invokedPath === currentPath) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
