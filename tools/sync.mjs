#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

export const contentRevision = (bytes) => bytes === null ? null : createHash("sha256").update(bytes).digest("hex");

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

function renderTarget(raw, rel, local, rules) {
  if (raw === null) return null;
  if (/\.(png|jpg|jpeg|gif|webp|lock)$/.test(rel)) return raw;
  const text = applySubstitutions(raw.toString("utf8"), rules).text;
  if (!isSkillFile(rel)) return Buffer.from(text);
  const upstream = splitMarkdown(text);
  if (upstream.frontmatter === null) return Buffer.from(text);
  const fm = mergeFrontmatter({ upstream: upstream.frontmatter, local: local === null ? null : splitMarkdown(local.toString("utf8")).frontmatter, rel });
  return Buffer.from(`---\n${fm}---\n${upstream.body}`);
}

const sameBytes = (a, b) => a === null || b === null ? a === b : a.equals(b);

export function syncComponent({ oldDir, newDir, localDir, rules, write = false, exclude = [], decisions = [], denylist = [] }) {
  const report = { candidates: [], planned: [], written: [], manual: [], deferred: [], hits: [], unchanged: 0, excluded: 0, counts: new Map(), pinReady: false };
  const reviewed = new Map();
  for (const decision of decisions) {
    if (reviewed.has(decision.path)) throw new Error(`duplicate review decision: ${decision.path}`);
    reviewed.set(decision.path, decision);
  }
  const paths = new Set([...listFiles(oldDir).map((p) => relative(oldDir, p)), ...listFiles(newDir).map((p) => relative(newDir, p))]);
  const operations = [];
  for (const rel of [...paths].sort()) {
    if (exclude.some((rule) => rel.startsWith(rule.pathPrefix))) {
      report.excluded++;
      continue;
    }
    const oldRaw = existsSync(join(oldDir, rel)) ? readFileSync(join(oldDir, rel)) : null;
    const newRaw = existsSync(join(newDir, rel)) ? readFileSync(join(newDir, rel)) : null;
    if (sameBytes(oldRaw, newRaw)) {
      report.unchanged++;
      continue;
    }
    const localFile = join(localDir, rel);
    const local = localBytes(localDir, rel);
    const target = renderTarget(newRaw, rel, local, rules);
    const base = renderTarget(oldRaw, rel, local, rules);
    const clean = sameBytes(local, base);
    const aligned = sameBytes(local, target);
    const kind = oldRaw === null ? "added" : newRaw === null ? "deleted" : "updated";
    const candidate = { path: rel, kind, revision: contentRevision(newRaw), localRevision: contentRevision(local), disposition: aligned ? "aligned" : clean ? "clean" : "local-edits", decision: null };
    report.candidates.push(candidate);
    const decision = reviewed.get(rel);
    const valid = decision && decision.revision === candidate.revision && typeof decision.reason === "string" && decision.reason.trim() && ["adopt", "adapt", "exclude", "defer"].includes(decision.action);
    if (!valid) {
      report.manual.push(rel);
      continue;
    }
    candidate.decision = decision.action;
    candidate.reason = decision.reason;
    if (decision.action === "defer") {
      report.deferred.push(rel);
      continue;
    }
    if (decision.action === "adapt" || decision.action === "exclude") {
      if (decision.localRevision !== candidate.localRevision) {
        report.manual.push(rel);
        continue;
      }
      if (decision.action === "adapt" && local !== null) report.hits.push(...denylistHits(rel, local.toString("utf8"), denylist));
      continue;
    }
    if (!clean && !aligned) {
      report.manual.push(rel);
      continue;
    }
    if (target !== null) report.hits.push(...denylistHits(rel, target.toString("utf8"), denylist));
    if (!aligned) {
      report.planned.push(`${kind}: ${rel}`);
      operations.push({ localFile, target, kind, rel, localRevision: candidate.localRevision });
      if (newRaw !== null) applySubstitutions(newRaw.toString("utf8"), rules).counts.forEach((n, p) => report.counts.set(p, (report.counts.get(p) ?? 0) + n));
    }
  }
  report.pinReady = report.manual.length === 0 && report.deferred.length === 0 && report.hits.length === 0;
  if (write && report.pinReady) {
    for (const operation of operations) {
      if (contentRevision(localBytes(localDir, operation.rel)) !== operation.localRevision) throw new Error(`sync target changed after review: ${operation.rel}`);
    }
    for (const { localFile, target, kind, rel, localRevision } of operations) {
      localBytes(localDir, rel);
      if (target === null) rmSync(localFile);
      else {
        mkdirSync(dirname(localFile), { recursive: true });
        const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (localRevision === null ? constants.O_EXCL : constants.O_TRUNC);
        const fd = openSync(localFile, flags);
        try { writeFileSync(fd, target); } finally { closeSync(fd); }
      }
      report.written.push(`${kind}: ${rel}`);
    }
  }
  return report;
}

function git(args, opts = {}) {
  try { return execFileSync("git", args, { encoding: "utf8", ...opts }); }
  catch (error) { throw new Error(`git ${args[0]} failed: ${String(error.stderr ?? error.message).slice(0, 1200)}`); }
}

export function parseSyncArgs(args) {
  const [component, sha, ...flags] = args;
  const options = { component, sha, apply: false, finalize: false, json: false, review: null, source: null };
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === "--apply") options.apply = true;
    else if (flag === "--finalize") { options.finalize = true; options.apply = true; }
    else if (flag === "--json") options.json = true;
    else if (flag === "--review" || flag === "--source") {
      const value = flags[++i];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
      options[flag.slice(2)] = value;
    } else throw new Error(`unknown option: ${flag}`);
  }
  if (!component || !sha?.match(/^[0-9a-f]{7,40}$/)) throw new Error("usage: bun tools/sync.mjs <component> <sha> [--json] [--review path] [--apply|--finalize] [--source git-checkout]");
  return options;
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
    if (options.finalize && options.source) {
      const registered = join(scratch, "registered");
      git(["init", "--bare", "--quiet", registered]);
      try { git(["-C", registered, "fetch", "--quiet", "--depth=1", upstream.remote, newSha]); }
      catch (error) { throw new Error(`target cannot be verified against registered upstream: ${error.message}`); }
    }
    const newDir = co(newSha, join(scratch, "new"));
    let decisions = [];
    let reviewMismatch = false;
    const reviewPath = options.review ?? (spec.review ? join(repository, spec.review) : null);
    if (reviewPath && existsSync(reviewPath)) {
      const document = JSON.parse(readFileSync(reviewPath, "utf8"));
      const review = document.components?.[component];
      if (review?.from === from && review?.to === newSha) decisions = review.decisions;
      else reviewMismatch = true;
    }

    const report = syncComponent({
      oldDir,
      newDir,
      localDir: join(repository, spec.localPath),
      rules: substitutions,
      write: options.apply,
      exclude: spec.exclude ?? [],
      decisions,
      denylist,
    });
    if (options.apply && reviewMismatch && report.candidates.length) throw new Error(`review revisions do not match ${component}: ${from} -> ${newSha}`);
    let pinAdvanced = false;
    if (options.finalize && report.pinReady && from !== newSha) {
      for (const [command, commandArgs] of [["bun", ["tools/generate.mjs"]], ["bash", ["tests/skill-collision-repro.sh"]], ["bun", ["test", "tests/"]]]) {
        execFileSync(command, commandArgs, { cwd: repository, stdio: ["ignore", "pipe", "pipe"] });
      }
      upstream.components[component].sha = newSha;
      writeFileSync(upstreamPath, JSON.stringify(upstream, null, 2) + "\n");
      pinAdvanced = true;
    }
    const result = { component, from, to: newSha, status: report.pinReady ? "reviewed" : "needs-review", ...report, counts: Object.fromEntries(report.counts), pinAdvanced };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${component}: ${result.status}; ${report.candidates.length} upstream changes; pin ${pinAdvanced ? "advanced" : "held"}`);
      for (const candidate of report.candidates) console.log(`${candidate.kind}: ${candidate.path} (${candidate.decision ?? "unreviewed"}, ${candidate.disposition})`);
      for (const hit of report.hits) console.error(hit);
    }
    return { result, exitCode: report.hits.length ? 1 : options.apply && !report.pinReady ? 2 : 0 };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main().exitCode; }
  catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
}
