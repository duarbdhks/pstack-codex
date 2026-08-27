#!/usr/bin/env bun
// Stamps facts that live in one source file into every file that carries a
// copy, and validates cross-file contracts. Idempotent; run it after editing
// a source of truth. CI contract: `bun tools/generate.mjs && git diff --exit-code`,
// so a stale committed copy fails the build instead of shipping.
//
// Sources of truth:
//   VERSION  -> the "version" field in the three plugin manifests
//   CHANGES.md must carry a heading for the current VERSION (release completeness)
//
// Also validated: .agents/plugins/marketplace.json points at a real plugin
// directory whose Codex manifest name matches (it carries no version; Codex
// reads the version from .codex-plugin/plugin.json).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const VERSIONED_MANIFESTS = [
  ".claude-plugin/marketplace.json",
  "plugins/pstack/.claude-plugin/plugin.json",
  "plugins/pstack/.codex-plugin/plugin.json",
];

// Replace the manifest's single "version" value, preserving all formatting.
// Exactly one "version" field per manifest is a precondition: a second one
// (say, from a future nested object) would make the blind replace ambiguous,
// so fail loudly and force this function to grow a targeted path instead.
export function stampVersion(text, version, file) {
  const fields = text.match(/"version"\s*:\s*"[^"]*"/g) ?? [];
  if (fields.length !== 1) {
    throw new Error(`${file}: expected exactly 1 "version" field, found ${fields.length}`);
  }
  return text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
}

export function assertChangesHeading(changes, version) {
  const found = changes
    .split("\n")
    .some((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
  if (!found) {
    throw new Error(
      `CHANGES.md has no "## ${version}" heading. Every version needs a CHANGES entry; ` +
        `a bump without one (or an entry without a bump) ships a release nobody can read about.`,
    );
  }
}

export function validateCodexMarketplace(text, { expectedName, pathExists }) {
  const manifest = JSON.parse(text);
  const plugins = manifest.plugins ?? [];
  if (plugins.length !== 1) {
    throw new Error(`.agents/plugins/marketplace.json: expected 1 plugin entry, found ${plugins.length}`);
  }
  const [plugin] = plugins;
  if (plugin.name !== expectedName) {
    throw new Error(
      `.agents/plugins/marketplace.json: plugin name "${plugin.name}" != Codex manifest name "${expectedName}"`,
    );
  }
  const path = plugin.source?.path;
  if (!path || !pathExists(path)) {
    throw new Error(`.agents/plugins/marketplace.json: source.path "${path}" does not resolve to a directory`);
  }
}

function main() {
  const version = readFileSync(join(repo, "VERSION"), "utf8").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`VERSION must be MAJOR.MINOR.PATCH, got "${version}"`);
  }

  assertChangesHeading(readFileSync(join(repo, "CHANGES.md"), "utf8"), version);
  console.log(`ok: CHANGES.md has a heading for ${version}`);

  for (const file of VERSIONED_MANIFESTS) {
    const path = join(repo, file);
    const text = readFileSync(path, "utf8");
    const stamped = stampVersion(text, version, file);
    if (stamped === text) {
      console.log(`ok: ${file} @ ${version}`);
    } else {
      writeFileSync(path, stamped);
      console.log(`stamped: ${file} -> ${version}`);
    }
  }

  const codexName = JSON.parse(
    readFileSync(join(repo, "plugins/pstack/.codex-plugin/plugin.json"), "utf8"),
  ).name;
  validateCodexMarketplace(readFileSync(join(repo, ".agents/plugins/marketplace.json"), "utf8"), {
    expectedName: codexName,
    pathExists: (p) => existsSync(join(repo, p)),
  });
  console.log("ok: .agents/plugins/marketplace.json names the plugin and points at a real path");
}

try {
  main();
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
}
