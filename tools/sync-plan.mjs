import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export function pushAction({ openPr, remoteExists, authorNames }) {
  const human = (authorNames ?? []).some((name) => name !== "github-actions[bot]");
  if (openPr && human) return "report-only";
  if (openPr) return "force-with-lease";
  if (remoteExists && human) return "report-only";
  if (remoteExists) return "force-with-lease";
  return "push";
}

export function issueAction({ needsAttention, openIssue }) {
  if (needsAttention) return openIssue ? "update" : "create";
  return openIssue ? "close" : "none";
}

export function nextRelease({ version, changes, sha, upstreamVersion, summary }) {
  const parts = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!parts) throw new Error(`VERSION must be MAJOR.MINOR.PATCH, got "${version.trim()}"`);
  const next = `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`;
  const at = changes.search(/^## /m);
  if (at === -1) throw new Error("CHANGES.md has no \"## \" heading to insert before");
  const heading = `## ${next} upstream sync ${sha.slice(0, 7)}${upstreamVersion ? ` (pstack ${upstreamVersion})` : ""}`;
  return { version: next, changes: `${changes.slice(0, at)}${heading}\n\n${summary.trimEnd()}\n\n${changes.slice(at)}` };
}

// Files a sync run writes outside the mirrored trees: generate.mjs stamps and the release bump.
const STAMPED = [
  /^plugins\/pstack\/\.codex-plugin\/plugin\.json$/,
  /^plugins\/pstack\/\.codex-plugin\/prompts\/[^/]+\.md$/,
  /^(README\.md|VERSION|CHANGES\.md|tools\/upstream\.json)$/,
];

const withoutPins = ({ components, ...rest }) => ({
  ...rest,
  components: Object.fromEntries(Object.entries(components).map(([name, { sha, ...spec }]) => [name, spec])),
});

// paths come from git apply --numstat, which names only a rename's destination,
// so a rename or copy arrives separately as { rename: <git apply --summary line> }.
export function patchViolations({ paths, upstream, patchedUpstream }) {
  // Component trees nest (cursor-team-kit lives inside pstack), so every tree
  // holding a path must leave it unowned, or one tree would unlock the other's port files.
  const mirrored = (path) => {
    const owners = Object.values(upstream.components).filter(({ localPath }) => path.startsWith(`${localPath}/`));
    return owners.length > 0 && owners.every(({ localPath, portOwned = [] }) =>
      !portOwned.some(({ pathPrefix }) => path.slice(localPath.length + 1).startsWith(pathPrefix)));
  };
  const violations = [];
  for (const path of paths) {
    if (typeof path !== "string") violations.push(`refused rename, copy, mode change, or link: ${path.rename}`);
    else if (!STAMPED.some((re) => re.test(path)) && !mirrored(path)) violations.push(`not a mirrored or stamped path: ${path}`);
  }
  if (!isDeepStrictEqual(withoutPins(upstream), withoutPins(patchedUpstream))) {
    violations.push("tools/upstream.json changes more than components.*.sha");
  }
  return violations;
}

function violationsOfPatch(root, patchFile) {
  const patch = resolve(patchFile);
  const scratch = mkdtempSync(join(tmpdir(), "sync-plan-"));
  try {
    const git = (args, env = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
    // A throwaway index shows the patched tools/upstream.json without touching the checkout.
    const index = { GIT_INDEX_FILE: join(scratch, "index") };
    git(["read-tree", "HEAD"], index);
    git(["apply", "--cached", patch], index);
    const paths = git(["apply", "--numstat", "-z", patch]).split("\0").filter(Boolean).map((entry) => entry.split("\t").slice(2).join("\t"));
    // The mirror writes regular files only, so a symlink, gitlink, or mode flip is foreign.
    const renames = git(["apply", "--summary", patch]).split("\n").filter((line) => /^ (rename|copy|mode change) | mode 1[26]0000 /.test(line)).map((line) => ({ rename: line.trim() }));
    return patchViolations({
      paths: [...paths, ...renames],
      upstream: JSON.parse(git(["show", "HEAD:tools/upstream.json"])),
      patchedUpstream: JSON.parse(git(["show", ":tools/upstream.json"], index)),
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (cmd === "issue") {
    process.stdout.write(issueAction({ needsAttention: rest[0] === "1", openIssue: rest[1] === "1" }));
  } else if (cmd === "release" && rest.length === 3) {
    const [sha, upstreamVersion, summaryFile] = rest;
    const release = nextRelease({
      version: readFileSync(join(root, "VERSION"), "utf8"),
      changes: readFileSync(join(root, "CHANGES.md"), "utf8"),
      sha,
      upstreamVersion: upstreamVersion === "-" ? null : upstreamVersion,
      summary: readFileSync(summaryFile, "utf8"),
    });
    writeFileSync(join(root, "VERSION"), `${release.version}\n`);
    writeFileSync(join(root, "CHANGES.md"), release.changes);
    process.stdout.write(release.version);
  } else if (cmd === "violations" && rest.length === 1) {
    process.stdout.write(violationsOfPatch(root, rest[0]).map((line) => `${line}\n`).join(""));
  } else if (cmd === "push") {
    const text = rest.join("\n");
    const [openPr, remoteExists, ...authorNames] = text.split("\n");
    process.stdout.write(
      pushAction({
        openPr: openPr === "1",
        remoteExists: remoteExists === "1",
        authorNames: authorNames.filter((name) => name.length > 0),
      }),
    );
  } else {
    process.stderr.write("usage: sync-plan.mjs issue <0|1> <0|1> | release <sha> <upstreamVersion|-> <summaryFile> | violations <patch> | push <flags>\n");
    process.exit(2);
  }
}
