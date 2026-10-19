import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueAction, nextRelease, patchViolations, pushAction } from "../tools/sync-plan.mjs";

const UPSTREAM = JSON.parse(readFileSync(join(import.meta.dir, "../tools/upstream.json"), "utf8"));

describe("issueAction", () => {
  test.each([
    [true, true, "update"],
    [true, false, "create"],
    [false, true, "close"],
    [false, false, "none"],
  ])("needsAttention=%p openIssue=%p -> %s", (needsAttention, openIssue, expected) => {
    expect(issueAction({ needsAttention, openIssue })).toBe(expected);
  });
});

describe("nextRelease", () => {
  const changes = "# Changes\n\nIntro paragraph.\n\n## 0.11.0 Previous\n\nOld notes.\n";

  test("bumps the patch and inserts the sync heading above the newest release", () => {
    expect(nextRelease({ version: "0.11.0\n", changes, sha: "7b353f78f6ec193bdbe48ed8059444eb09b6878e", upstreamVersion: "0.15.27", summary: "- pstack: 3 added\n" })).toEqual({
      version: "0.11.1",
      changes: "# Changes\n\nIntro paragraph.\n\n## 0.11.1 upstream sync 7b353f7 (pstack 0.15.27)\n\n- pstack: 3 added\n\n## 0.11.0 Previous\n\nOld notes.\n",
    });
  });

  test("omits the pstack version when upstream has none", () => {
    expect(nextRelease({ version: "0.9.24", changes, sha: "abcdef0123", upstreamVersion: null, summary: "cursor-team-kit only" }).changes).toBe(
      "# Changes\n\nIntro paragraph.\n\n## 0.9.25 upstream sync abcdef0\n\ncursor-team-kit only\n\n## 0.11.0 Previous\n\nOld notes.\n",
    );
  });

  test("rejects a malformed VERSION", () => {
    expect(() => nextRelease({ version: "v1", changes, sha: "abcdef0", upstreamVersion: null, summary: "" })).toThrow("MAJOR.MINOR.PATCH");
  });
});

describe("pushAction", () => {
  test("no remote branch pushes normally", () => {
    expect(pushAction({ openPr: false, remoteExists: false, authorNames: [] })).toBe("push");
  });

  test("bot-only orphan refreshes with a lease", () => {
    expect(
      pushAction({
        openPr: false,
        remoteExists: true,
        authorNames: ["github-actions[bot]"],
      }),
    ).toBe("force-with-lease");
  });

  test("orphan contained in main still refreshes with a lease", () => {
    expect(pushAction({ openPr: false, remoteExists: true, authorNames: [] })).toBe(
      "force-with-lease",
    );
  });

  test("human commit on an orphan reports only", () => {
    expect(
      pushAction({
        openPr: false,
        remoteExists: true,
        authorNames: ["github-actions[bot]", "duarbdhks"],
      }),
    ).toBe("report-only");
  });

  test("open bot PR refreshes with a lease", () => {
    expect(
      pushAction({
        openPr: true,
        remoteExists: true,
        authorNames: ["github-actions[bot]"],
      }),
    ).toBe("force-with-lease");
  });

  test("open PR with a human commit reports only", () => {
    expect(
      pushAction({ openPr: true, remoteExists: true, authorNames: ["duarbdhks"] }),
    ).toBe("report-only");
  });
});

describe("patchViolations", () => {
  const flagged = (paths, patchedUpstream = UPSTREAM) => patchViolations({ paths, upstream: UPSTREAM, patchedUpstream }).length > 0;

  test.each([
    ["plugins/pstack/skills/how/SKILL.md", false],
    ["plugins/pstack/skills/thermo-nuclear-code-quality-review/references/report.md", false],
    ["plugins/pstack/.codex-plugin/prompts/how.md", false],
    ["plugins/pstack/.codex-plugin/plugin.json", false],
    ["README.md", false],
    ["VERSION", false],
    ["CHANGES.md", false],
    ["tools/upstream.json", false],
    ["plugins/pstack/models.json", true],
    ["plugins/pstack/skills/babysit/SKILL.md", true],
    ["plugins/pstack/skills/thermo-nuclear-code-quality-review/SKILL.md", true],
    ["plugins/pstack/.codex-plugin/hooks.json", true],
    ["plugins/pstack/.codex-plugin/prompts/nested/how.md", true],
    [".github/workflows/ci.yml", true],
    ["tools/sync.mjs", true],
  ])("%s flagged=%p", (path, expected) => {
    expect(flagged([path])).toBe(expected);
  });

  test("tools/upstream.json may move only component pins", () => {
    const pinned = structuredClone(UPSTREAM);
    pinned.components.pstack.sha = "d457567332aa6989e753ea289f30ea2bfbc80bc0";
    expect(flagged(["tools/upstream.json"], pinned)).toBe(false);
    const unowned = structuredClone(pinned);
    unowned.components.pstack.portOwned.pop();
    expect(flagged(["tools/upstream.json"], unowned)).toBe(true);
  });

  test("a rename is refused even between mirrored paths", () => {
    expect(flagged([{ rename: "rename plugins/pstack/skills/{a => b}/SKILL.md (100%)" }])).toBe(true);
  });
});

describe("violations CLI", () => {
  // The real tools and policy in a scratch repository, so patches run through git apply.
  function landingRepo() {
    const dir = mkdtempSync(join(tmpdir(), "sync-plan-fixture-"));
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    for (const rel of ["tools/sync-plan.mjs", "tools/upstream.json"]) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      copyFileSync(join(import.meta.dir, "..", rel), join(dir, rel));
    }
    mkdirSync(join(dir, "plugins/pstack/skills/how"), { recursive: true });
    writeFileSync(join(dir, "plugins/pstack/models.json"), '{"port": true}\n');
    writeFileSync(join(dir, "plugins/pstack/skills/how/SKILL.md"), "---\nname: how\n---\n\nHow.\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-q", "-m", "base");
    // Stage an edit, keep it as a patch, and restore the checkout the land job starts from.
    const patchOf = (edit) => {
      edit(dir);
      git("add", "-A");
      const patch = join(mkdtempSync(join(tmpdir(), "sync-plan-patch-")), "mirror.patch");
      writeFileSync(patch, git("diff", "--cached", "--binary", "-M", "--no-color"));
      git("reset", "-q", "--hard", "HEAD");
      return patch;
    };
    const violations = (patch) => spawnSync(process.execPath, [join(dir, "tools/sync-plan.mjs"), "violations", patch], { encoding: "utf8" });
    return { patchOf, violations };
  }

  test("a mirrored edit with a pin bump passes; a rename out of a port-owned file is caught", () => {
    const { patchOf, violations } = landingRepo();
    const clean = violations(patchOf((dir) => {
      writeFileSync(join(dir, "plugins/pstack/skills/how/SKILL.md"), "---\nname: how\n---\n\nHow, updated.\n");
      const path = join(dir, "tools/upstream.json");
      const upstream = JSON.parse(readFileSync(path, "utf8"));
      upstream.components.pstack.sha = "d457567332aa6989e753ea289f30ea2bfbc80bc0";
      writeFileSync(path, JSON.stringify(upstream, null, 2) + "\n");
    }));
    expect(clean.status).toBe(0);
    expect(clean.stdout).toBe("");

    const renamed = violations(patchOf((dir) => renameSync(join(dir, "plugins/pstack/models.json"), join(dir, "plugins/pstack/skills/how/models.json"))));
    expect(renamed.status).toBe(0);
    expect(renamed.stdout).toContain("rename");

    const linked = violations(patchOf((dir) => symlinkSync("../../models.json", join(dir, "plugins/pstack/skills/how/link.md"))));
    expect(linked.status).toBe(0);
    expect(linked.stdout).toContain("create mode 120000");
  });
});
