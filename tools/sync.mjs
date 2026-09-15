#!/usr/bin/env bun
// Sync this port forward to a new upstream SHA.
//
//   bun tools/sync.mjs <component> <new-sha>     e.g. bun tools/sync.mjs pstack abc1234
//
// Reads tools/upstream.json (remote + per-component pin + exclusions) and
// tools/substitutions.json (mechanical Cursor->Claude rewrites plus a denylist
// of Cursor-isms that need a human sentence, not a token swap). For each file
// that changed upstream between the pinned SHA and the new one:
//
//   - path matches a component ExclusionRule prefix -> skipped, never written
//   - local copy matches the substituted OLD upstream text -> clean update, written
//   - SKILL.md whose local body matches the substituted OLD body -> clean update;
//     the new body is written under a frontmatter merged per FRONTMATTER_POLICY
//   - local copy is missing -> new file, written
//   - local copy differs (port-specific edits) -> left alone, reported for manual merge
//
// Every written file is then denylist-scanned; a hit fails the run with file,
// line, and the hint for that token, leaving the tree for inspection. The pin
// in upstream.json is advanced only when the run succeeds. The printed report
// (files written, per-rule substitution counts, manual-merge list) is the raw
// material for the CHANGES.md entry.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

// Compare old-upstream vs new-upstream vs local for one component tree.
// Returns { written, manual, unchanged, excluded, counts } and writes clean
// updates. `exclude` is the component's ExclusionRule list from upstream.json.
export function syncComponent({ oldDir, newDir, localDir, rules, write, exclude = [] }) {
  const report = { written: [], manual: [], unchanged: 0, excluded: 0, counts: new Map() };
  for (const newFile of listFiles(newDir)) {
    const rel = relative(newDir, newFile);
    if (exclude.some((rule) => rel.startsWith(rule.pathPrefix))) {
      report.excluded++;
      continue;
    }
    const localFile = join(localDir, rel);
    const oldFile = join(oldDir, rel);
    const newRaw = readFileSync(newFile);
    const isText = !rel.match(/\.(png|jpg|gif|lock)$/);
    const subNew = isText ? applySubstitutions(newRaw.toString("utf8"), rules) : null;

    // The write target: substituted upstream text, with SKILL.md frontmatter
    // rebuilt per FRONTMATTER_POLICY so port-owned keys survive the update.
    const renderTarget = (localText) => {
      if (!subNew) return newRaw;
      if (!isSkillFile(rel)) return Buffer.from(subNew.text);
      const newSplit = splitMarkdown(subNew.text);
      if (newSplit.frontmatter === null) return Buffer.from(subNew.text);
      const local = localText === null ? null : splitMarkdown(localText).frontmatter;
      const fm = mergeFrontmatter({ upstream: newSplit.frontmatter, local, rel });
      return Buffer.from(`---\n${fm}---\n${newSplit.body}`);
    };

    if (!existsSync(localFile)) {
      if (write) {
        mkdirSync(dirname(localFile), { recursive: true });
        writeFileSync(localFile, renderTarget(null));
      }
      report.written.push(`added: ${rel}`);
      subNew?.counts.forEach((n, p) => report.counts.set(p, (report.counts.get(p) ?? 0) + n));
      continue;
    }
    const local = readFileSync(localFile);
    const localText = isText ? local.toString("utf8") : null;
    const newTarget = renderTarget(localText);
    if (local.equals(newTarget)) {
      report.unchanged++;
      continue;
    }
    // Did the port edit this file beyond the mechanical substitutions? Judge
    // against the substituted OLD upstream text; equality there means every
    // local difference came from upstream drift, so the update is clean. For
    // a SKILL.md, equal bodies are enough: the frontmatter diverges by design
    // (FRONTMATTER_POLICY), so only body edits mark a file port-specific.
    let cleanBase = false;
    if (existsSync(oldFile) && isText) {
      const subOld = applySubstitutions(readFileSync(oldFile, "utf8"), rules);
      cleanBase = localText === subOld.text;
      if (!cleanBase && isSkillFile(rel)) {
        const localSplit = splitMarkdown(localText);
        cleanBase = localSplit.frontmatter !== null && localSplit.body === splitMarkdown(subOld.text).body;
      }
    }
    if (cleanBase) {
      if (write) writeFileSync(localFile, newTarget);
      report.written.push(`updated: ${rel}`);
      subNew?.counts.forEach((n, p) => report.counts.set(p, (report.counts.get(p) ?? 0) + n));
    } else {
      report.manual.push(rel);
    }
  }
  return report;
}

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", ...opts });
}

function main() {
  const [component, newSha] = process.argv.slice(2);
  const upstreamPath = join(repo, "tools/upstream.json");
  const upstream = JSON.parse(readFileSync(upstreamPath, "utf8"));
  const spec = upstream.components[component];
  if (!spec || !newSha?.match(/^[0-9a-f]{7,40}$/)) {
    console.error(`usage: bun tools/sync.mjs <${Object.keys(upstream.components).join("|")}> <new-sha>`);
    process.exit(2);
  }
  const { substitutions, denylist } = JSON.parse(readFileSync(join(repo, "tools/substitutions.json"), "utf8"));

  const scratch = mkdtempSync(join(tmpdir(), "pstack-sync-"));
  try {
    console.log(`cloning ${upstream.remote} ...`);
    git(["clone", "--quiet", upstream.remote, join(scratch, "clone")]);
    const co = (sha, dest) => {
      git(["-C", join(scratch, "clone"), "worktree", "add", "--detach", dest, sha]);
      return join(dest, spec.upstreamPath);
    };
    const oldDir = co(spec.sha, join(scratch, "old"));
    const newDir = co(newSha, join(scratch, "new"));

    const report = syncComponent({
      oldDir,
      newDir,
      localDir: join(repo, spec.localPath),
      rules: substitutions,
      write: true,
      exclude: spec.exclude ?? [],
    });

    const hits = report.written.flatMap((entry) => {
      const rel = entry.replace(/^(added|updated): /, "");
      const path = join(spec.localPath, rel);
      return denylistHits(path, readFileSync(join(repo, path), "utf8"), denylist);
    });

    console.log(`\nunchanged: ${report.unchanged} files`);
    if (report.excluded) console.log(`excluded: ${report.excluded} files (upstream.json exclusions)`);
    for (const w of report.written) console.log(w);
    for (const [pattern, n] of report.counts) console.log(`substituted: "${pattern}" x${n}`);
    if (report.manual.length) {
      console.log(`\nneeds manual merge (port-specific edits meet upstream changes):`);
      for (const m of report.manual) console.log(`  ${spec.localPath}/${m}`);
    }
    if (hits.length) {
      console.error(`\nFAIL: Cursor-isms in synced files; add a substitution or rewrite by hand, then rerun:`);
      for (const h of hits) console.error(`  ${h}`);
      process.exit(1);
    }

    upstream.components[component].sha = newSha;
    writeFileSync(upstreamPath, JSON.stringify(upstream, null, 2) + "\n");
    console.log(`\npinned: ${component} -> ${newSha}`);
    console.log("next: review the diff, resolve the manual-merge list, write the CHANGES.md entry from this report, run bun tools/generate.mjs");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
