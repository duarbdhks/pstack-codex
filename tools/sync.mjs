#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_SLUG_RE } from "./generate.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

export function applySubstitutions(text, rules) {
  const counts = new Map();
  let out = text;
  for (const rule of rules) {
    const before = out;
    out = out.split(rule.pattern).join(rule.replacement);
    if (out !== before) {
      const n = before.split(rule.pattern).length - 1;
      counts.set(rule.pattern, (counts.get(rule.pattern) ?? 0) + n);
    }
  }
  return { text: out, counts };
}

export function denylistHits(path, text, denylist) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const { token, hint } of denylist) {
      if (line.includes(token)) hits.push(`${path}:${i + 1}: "${token}" — ${hint}`);
    }
  });
  return hits;
}

export function splitMarkdown(text) {
  const m = text.match(/^---\n([\s\S]*?\n)---\n/);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

// Who owns which SKILL.md frontmatter key when the sync writes a file. The
// port owns its invocation surface, upstream owns identity, and Cursor-only
// flags never land here because the Codex runtime has no reader for them.
const FRONTMATTER_POLICY = {
  portOwned: ["menu-description", "user-invocable"],
  dropped: ["disable-model-invocation", "mode", "icon", "color", "reminder", "is_background"],
};

const isSkillFile = (rel) => rel.split("/").at(-1) === "SKILL.md";
const isPrincipleLeaf = (rel) => /(^|\/)principle-[^/]+\/SKILL\.md$/.test(rel);
const utf8 = new TextDecoder("utf-8", { fatal: true });
// Content decides too: a text round trip would corrupt an unlisted binary such as a .wasm.
function isBinary(rel, bytes) {
  if (/\.(png|jpg|jpeg|gif|webp|lock)$/.test(rel) || bytes.includes(0)) return true;
  try { utf8.decode(bytes); return false; } catch { return true; }
}
const matches = (rel, rules) => rules.some((rule) => rel.startsWith(rule.pathPrefix));

// A block is one top-level key plus its continuation lines, so folded YAML
// scalars survive the merge without a YAML parser.
function frontmatterBlocks(fm) {
  const blocks = [];
  for (const line of fm.replace(/\n$/, "").split("\n")) {
    const key = line.match(/^([A-Za-z0-9_-]+):/)?.[1];
    if (key) blocks.push({ key, lines: [line] });
    else if (blocks.length) blocks.at(-1).lines.push(line);
  }
  return blocks;
}

export function mergeFrontmatter({ upstream, local, rel }) {
  const owned = new Set([...FRONTMATTER_POLICY.portOwned, ...FRONTMATTER_POLICY.dropped]);
  const merged = frontmatterBlocks(upstream).filter((b) => !owned.has(b.key));
  const localBlocks = new Map(frontmatterBlocks(local ?? "").map((b) => [b.key, b]));
  for (const key of FRONTMATTER_POLICY.portOwned) {
    if (localBlocks.has(key)) merged.push(localBlocks.get(key));
  }
  if (isPrincipleLeaf(rel)) {
    const rest = merged.filter((b) => b.key !== "user-invocable");
    rest.push({ key: "user-invocable", lines: ["user-invocable: false"] });
    return rest.map((b) => b.lines.join("\n")).join("\n") + "\n";
  }
  return merged.map((b) => b.lines.join("\n")).join("\n") + "\n";
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "node_modules") continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`symlink is not a sync input: ${full}`);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function localBytes(dir, rel) {
  if (lstatSync(dir).isSymbolicLink()) throw new Error(`symlink is not a sync target: ${dir}`);
  let current = dir;
  for (const part of rel.split("/")) {
    current = join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`symlink is not a sync target: ${current}`);
    }
  }
  return existsSync(current) ? readFileSync(current) : null;
}

const ROLE_MODEL = "<role model>";
const MODEL_SLUGS = new RegExp(MODEL_SLUG_RE.source, "g");
// Codex reads this file to keep a skill explicit-only, the meaning of
// Cursor's disable-model-invocation, which the frontmatter merge drops.
const INVOCATION_POLICY = Buffer.from("policy:\n  allow_implicit_invocation: false\n");

const tally = (counts, key, n) => counts.set(key, (counts.get(key) ?? 0) + n);

function renderTarget(raw, rel, local, rules, counts) {
  if (isBinary(rel, raw)) return raw;
  const substituted = applySubstitutions(raw.toString("utf8"), rules);
  substituted.counts.forEach((n, pattern) => tally(counts, pattern, n));
  let text = substituted.text;
  if (rel.endsWith(".md")) {
    text = text.replace(MODEL_SLUGS, () => {
      tally(counts, ROLE_MODEL, 1);
      return ROLE_MODEL;
    });
  }
  if (!isSkillFile(rel)) return Buffer.from(text);
  const upstream = splitMarkdown(text);
  if (upstream.frontmatter === null) return Buffer.from(text);
  const fm = mergeFrontmatter({ upstream: upstream.frontmatter, local: local === null ? null : splitMarkdown(local.toString("utf8")).frontmatter, rel });
  return Buffer.from(`---\n${fm}---\n${upstream.body}`);
}

const sameBytes = (a, b) => a === null || b === null ? a === b : a.equals(b);
const treeBytes = (dir, rel) => existsSync(join(dir, rel)) ? readFileSync(join(dir, rel)) : null;
const disablesModelInvocation = (raw) => (splitMarkdown(raw.toString("utf8")).frontmatter ?? "").split("\n").includes("disable-model-invocation: true");

function writeTarget(localDir, rel, target) {
  const exists = localBytes(localDir, rel) !== null;
  const file = join(localDir, rel);
  if (target === null) {
    if (exists) rmSync(file);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (exists ? constants.O_TRUNC : constants.O_EXCL));
  try { writeFileSync(fd, target); } finally { closeSync(fd); }
}

export function syncComponent({ oldDir, newDir, localDir, rules, apply = false, exclude = [], portOwned = [], remap = [], denylist = [] }) {
  const report = { changes: [], portOwnedChanged: [], warnings: [], counts: new Map(), unchanged: 0, excluded: 0 };
  const files = (dir) => listFiles(dir).map((p) => relative(dir, p));
  const paths = [...new Set([...files(oldDir), ...files(newDir)])].sort();
  const operations = new Map();
  const skills = [];
  for (const rel of paths) {
    const remapped = remap.find((rule) => rule.from === rel);
    if (!remapped && matches(rel, exclude)) {
      report.excluded++;
      continue;
    }
    const localRel = remapped?.to ?? rel;
    const oldRaw = treeBytes(oldDir, rel);
    const newRaw = treeBytes(newDir, rel);
    if (matches(localRel, portOwned)) {
      if (!sameBytes(oldRaw, newRaw)) report.portOwnedChanged.push(localRel);
      continue;
    }
    if (isSkillFile(localRel)) skills.push({ localRel, newRaw });
    if (sameBytes(oldRaw, newRaw)) {
      report.unchanged++;
      continue;
    }
    const local = localBytes(localDir, localRel);
    const target = newRaw === null ? null : renderTarget(newRaw, localRel, local, rules, report.counts);
    if (target !== null && !isBinary(localRel, target)) report.warnings.push(...denylistHits(localRel, target.toString("utf8"), denylist));
    operations.set(localRel, { kind: oldRaw === null ? "added" : newRaw === null ? "deleted" : "updated", target });
  }
  for (const { localRel, newRaw } of skills) {
    const policyRel = join(dirname(localRel), "agents/openai.yaml");
    const skill = operations.get(localRel);
    const present = skill ? skill.target !== null : localBytes(localDir, localRel) !== null;
    const desired = present && newRaw !== null && disablesModelInvocation(newRaw) ? INVOCATION_POLICY : null;
    const local = localBytes(localDir, policyRel);
    if (sameBytes(local, desired)) continue;
    operations.set(policyRel, { kind: local === null ? "added" : desired === null ? "deleted" : "updated", target: desired });
  }
  for (const [path, { kind, target }] of operations) {
    report.changes.push({ path, kind });
    if (apply) writeTarget(localDir, path, target);
  }
  return report;
}

function git(args, opts = {}) {
  try { return execFileSync("git", args, { encoding: "utf8", ...opts }); }
  catch (error) { throw new Error(`git ${args[0]} failed: ${String(error.stderr ?? error.message).slice(0, 1200)}`); }
}

export function parseSyncArgs(args) {
  const [component, sha, ...flags] = args;
  const options = { component, sha, apply: false, full: false, json: false, source: null };
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === "--apply" || flag === "--full" || flag === "--json") options[flag.slice(2)] = true;
    else if (flag === "--source") {
      const value = flags[++i];
      if (!value || value.startsWith("--")) throw new Error("--source requires a path");
      options.source = value;
    } else throw new Error(`unknown option: ${flag}`);
  }
  if (!component || !sha?.match(/^[0-9a-f]{7,40}$/)) throw new Error("usage: bun tools/sync.mjs <component> <sha> [--json] [--apply] [--full] [--source <git-checkout>]");
  return options;
}

function pluginVersion(dir) {
  const manifest = join(dir, ".cursor-plugin/plugin.json");
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version ?? null : null;
}

export function main(args = process.argv.slice(2), repository = repo) {
  const options = parseSyncArgs(args);
  const { component } = options;
  const upstreamPath = join(repository, "tools/upstream.json");
  const upstream = JSON.parse(readFileSync(upstreamPath, "utf8"));
  const spec = upstream.components[component];
  if (!spec) throw new Error(`unknown component: ${component}`);
  const from = spec.sha;
  const { substitutions, denylist } = JSON.parse(readFileSync(join(repository, "tools/substitutions.json"), "utf8"));

  const scratch = mkdtempSync(join(tmpdir(), "pstack-sync-"));
  try {
    const clone = options.source ?? join(scratch, "clone");
    if (!options.source) git(["clone", "--quiet", "--no-checkout", upstream.remote, clone]);
    const co = (sha, dest) => {
      mkdirSync(dest);
      const archive = git(["-C", clone, "archive", "--format=tar", `${sha}:${spec.upstreamPath}`], { encoding: null, maxBuffer: 32 * 1024 * 1024 });
      execFileSync("tar", ["-x", "-C", dest], { input: archive });
      return dest;
    };
    const oldDir = co(from, join(scratch, "old"));
    const newSha = git(["-C", clone, "rev-parse", `${options.sha}^{commit}`]).trim();
    const newDir = co(newSha, join(scratch, "new"));
    const empty = join(scratch, "empty");
    mkdirSync(empty);

    const report = syncComponent({
      oldDir: options.full ? empty : oldDir,
      newDir,
      localDir: join(repository, spec.localPath),
      rules: substitutions,
      apply: options.apply,
      exclude: spec.exclude ?? [],
      portOwned: spec.portOwned ?? [],
      remap: spec.remap ?? [],
      denylist,
    });
    const status = report.changes.length || report.portOwnedChanged.length ? "changed" : "current";
    const pinAdvanced = options.apply && status === "changed" && from !== newSha;
    if (pinAdvanced) {
      upstream.components[component].sha = newSha;
      writeFileSync(upstreamPath, JSON.stringify(upstream, null, 2) + "\n");
    }
    const result = {
      component,
      from,
      to: newSha,
      fromVersion: pluginVersion(oldDir),
      toVersion: pluginVersion(newDir),
      status,
      changes: report.changes,
      portOwnedChanged: report.portOwnedChanged,
      warnings: report.warnings,
      counts: Object.fromEntries(report.counts),
      unchanged: report.unchanged,
      excluded: report.excluded,
      applied: options.apply,
      pinAdvanced,
    };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      const kinds = ["added", "updated", "deleted"].map((kind) => `${report.changes.filter((c) => c.kind === kind).length} ${kind}`);
      console.log(`${component}: ${status} ${from.slice(0, 7)} -> ${newSha.slice(0, 7)}; ${kinds.join(", ")}; pin ${pinAdvanced ? "advanced" : "held"}`);
      for (const path of report.portOwnedChanged) console.log(`port-owned, changed upstream: ${path}`);
      for (const warning of report.warnings) console.log(`warning: ${warning}`);
    }
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
