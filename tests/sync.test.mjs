import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { applySubstitutions, denylistHits, main, parseSyncArgs, syncComponent } from "../tools/sync.mjs";

const RULES = JSON.parse(readFileSync(join(import.meta.dir, "../tools/substitutions.json"), "utf8"));

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "sync-fixture-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

const revision = (text) => createHash("sha256").update(text).digest("hex");
const adopt = (dir, paths) => paths.map((path) => ({ path, revision: revision(readFileSync(join(dir, path))), action: "adopt", reason: "reviewed fixture" }));

describe("reviewed sync safety", () => {
  test("unchanged upstream preserves local edits without a false conflict", () => {
    const oldDir = tree({ "a.md": "upstream\n" });
    const newDir = tree({ "a.md": "upstream\n" });
    const localDir = tree({ "a.md": "Codex adaptation\n" });
    const result = syncComponent({ oldDir, newDir, localDir, rules: [], write: false });
    expect(result.manual).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(readFileSync(join(localDir, "a.md"), "utf8")).toBe("Codex adaptation\n");
  });

  test("new files remain candidates until adopted", () => {
    const localDir = tree({});
    const result = syncComponent({ oldDir: tree({}), newDir: tree({ "a.md": "new\n" }), localDir, rules: [], write: true });
    expect(existsSync(join(localDir, "a.md"))).toBe(false);
    expect(result.pinReady).toBe(false);
    expect(result.manual).toEqual(["a.md"]);
  });

  test("an adopted addition cannot follow a dangling symlink outside the target", () => {
    const localDir = tree({});
    const outside = join(tree({}), "outside.md");
    symlinkSync(outside, join(localDir, "a.md"));
    expect(() => syncComponent({ oldDir: tree({}), newDir: tree({ "a.md": "new\n" }), localDir, rules: [], write: true,
      decisions: [{ path: "a.md", revision: revision("new\n"), action: "adopt", reason: "reviewed" }] })).toThrow("symlink");
    expect(existsSync(outside)).toBe(false);
  });

  test("a changed source invalidates an old adoption decision", () => {
    const localDir = tree({});
    const result = syncComponent({ oldDir: tree({}), newDir: tree({ "a.md": "newer\n" }), localDir, rules: [], write: true,
      decisions: [{ path: "a.md", revision: revision("new\n"), action: "adopt", reason: "reviewed" }] });
    expect(result.pinReady).toBe(false);
    expect(existsSync(join(localDir, "a.md"))).toBe(false);
  });

  test("a deferred candidate prevents writes and pin advancement for the batch", () => {
    const localDir = tree({});
    const result = syncComponent({ oldDir: tree({}), newDir: tree({ "a.md": "a\n", "b.md": "b\n" }), localDir, rules: [], write: true,
      decisions: [
        { path: "a.md", revision: revision("a\n"), action: "adopt", reason: "useful" },
        { path: "b.md", revision: revision("b\n"), action: "defer", reason: "needs design" },
      ] });
    expect(result.pinReady).toBe(false);
    expect(result.deferred).toEqual(["b.md"]);
    expect(existsSync(join(localDir, "a.md"))).toBe(false);
  });

  test("reviewed adaptations require the reviewed local content", () => {
    const localDir = tree({ "a.md": "native contract\n" });
    const args = { oldDir: tree({ "a.md": "old\n" }), newDir: tree({ "a.md": "new\n" }), localDir, rules: [], write: true,
      decisions: [{ path: "a.md", revision: revision("new\n"), localRevision: revision("native contract\n"), action: "adapt", reason: "Codex execution" }] };
    expect(syncComponent(args).pinReady).toBe(true);
    writeFileSync(join(localDir, "a.md"), "unreviewed edit\n");
    expect(syncComponent(args).pinReady).toBe(false);
    expect(readFileSync(join(localDir, "a.md"), "utf8")).toBe("unreviewed edit\n");
  });

  test("upstream deletion is reported and requires an explicit decision", () => {
    const localDir = tree({ "a.md": "old\n" });
    const args = { oldDir: tree({ "a.md": "old\n" }), newDir: tree({}), localDir, rules: [], write: true };
    const preview = syncComponent(args);
    expect(preview.candidates[0].kind).toBe("deleted");
    expect(existsSync(join(localDir, "a.md"))).toBe(true);
    const result = syncComponent({ ...args, decisions: [{ path: "a.md", revision: null, action: "adopt", reason: "retired upstream" }] });
    expect(result.pinReady).toBe(true);
    expect(existsSync(join(localDir, "a.md"))).toBe(false);
  });

  test("denied content prevents every planned write", () => {
    const localDir = tree({});
    const result = syncComponent({ oldDir: tree({}), newDir: tree({ "a.md": "safe\n", "b.md": "control-ui\n" }), localDir, rules: [], write: true,
      denylist: [{ token: "control-ui", hint: "select a native driver" }],
      decisions: [
        { path: "a.md", revision: revision("safe\n"), action: "adopt", reason: "reviewed" },
        { path: "b.md", revision: revision("control-ui\n"), action: "adopt", reason: "reviewed" },
      ] });
    expect(result.pinReady).toBe(false);
    expect(result.hits).toHaveLength(1);
    expect(existsSync(join(localDir, "a.md"))).toBe(false);
  });
});

describe("applySubstitutions", () => {
  test("rewrites Cursor primitives and counts per rule", () => {
    const { text, counts } = applySubstitutions(
      "Use the `Task` tool, then AskQuestion. Skills live in .cursor/skills/.",
      RULES.substitutions,
    );
    expect(text).toBe("Use the `Agent` tool, then AskUserQuestion. Skills live in .claude/skills/.");
    expect(counts.get("AskQuestion")).toBe(1);
  });

  test("leaves AskUserQuestion alone", () => {
    const { text } = applySubstitutions("Prefer AskUserQuestion here.", RULES.substitutions);
    expect(text).toBe("Prefer AskUserQuestion here.");
  });
});

describe("denylistHits", () => {
  test("flags residual Cursor-isms with file, line, and hint", () => {
    const hits = denylistHits("skills/x/SKILL.md", "line one\nrun control-cli now\n", RULES.denylist);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("skills/x/SKILL.md:2");
    expect(hits[0]).toContain("control-cli");
  });
});

describe("syncComponent", () => {
  test("clean update, new file, and port-edited file each route correctly", () => {
    const oldUp = tree({
      "skills/a/SKILL.md": "Step 1: AskQuestion about scope.\n",
      "skills/b/SKILL.md": "Old b body.\n",
    });
    const newUp = tree({
      "skills/a/SKILL.md": "Step 1: AskQuestion about scope. Step 2: verify.\n",
      "skills/b/SKILL.md": "New b body.\n",
      "skills/c/SKILL.md": "Brand new skill. AskQuestion early.\n",
    });
    const local = tree({
      // a matches substituted old upstream -> clean update expected
      "skills/a/SKILL.md": "Step 1: AskUserQuestion about scope.\n",
      // b carries a port-specific edit -> manual merge expected
      "skills/b/SKILL.md": "Old b body, plus a Platform note the port added.\n",
    });

    const report = syncComponent({ oldDir: oldUp, newDir: newUp, localDir: local, rules: RULES.substitutions, write: true,
      decisions: adopt(newUp, ["skills/a/SKILL.md", "skills/c/SKILL.md"]) });

    expect(report.planned).toEqual(["updated: skills/a/SKILL.md", "added: skills/c/SKILL.md"]);
    expect(report.written).toEqual([]);
    expect(report.manual).toEqual(["skills/b/SKILL.md"]);
    expect(readFileSync(join(local, "skills/a/SKILL.md"), "utf8")).toBe(
      "Step 1: AskUserQuestion about scope.\n",
    );
    expect(existsSync(join(local, "skills/c/SKILL.md"))).toBe(false);
    expect(readFileSync(join(local, "skills/b/SKILL.md"), "utf8")).toBe(
      "Old b body, plus a Platform note the port added.\n",
    );
  });

  test("excluded prefixes are never written, even as new files", () => {
    const newUp = tree({
      "assets/logo.png": "png bytes\n",
      "README.md": "upstream readme\n",
      "skills/keep/SKILL.md": "---\nname: keep\ndescription: kept skill\n---\n\nKept body.\n",
    });
    const local = tree({});
    const report = syncComponent({
      oldDir: tree({}),
      newDir: newUp,
      localDir: local,
      rules: RULES.substitutions,
      write: true,
      decisions: adopt(newUp, ["skills/keep/SKILL.md"]),
      exclude: [
        { pathPrefix: "assets/", reason: "not ported" },
        { pathPrefix: "README.md", reason: "port-owned" },
      ],
    });
    expect(report.excluded).toBe(2);
    expect(report.written).toEqual(["added: skills/keep/SKILL.md"]);
    expect(existsSync(join(local, "README.md"))).toBe(false);
    expect(existsSync(join(local, "assets/logo.png"))).toBe(false);
  });

  test("body-only local drift is clean: new body lands under merged frontmatter", () => {
    const oldUp = tree({
      "skills/a/SKILL.md":
        "---\nname: a\ndescription: old words\ndisable-model-invocation: true\nmode: true\nicon: crown\n---\n\nShared body. AskQuestion early.\n",
    });
    const newUp = tree({
      "skills/a/SKILL.md":
        "---\nname: a\ndescription: new words\ndisable-model-invocation: true\nmode: true\nicon: crown\ncolor: yellow\n---\n\nShared body. AskQuestion early. New paragraph.\n",
    });
    const local = tree({
      "skills/a/SKILL.md":
        "---\nname: a\ndescription: old words\nmenu-description: port menu line\n---\n\nShared body. AskUserQuestion early.\n",
    });
    const args = { oldDir: oldUp, newDir: newUp, localDir: local, rules: RULES.substitutions, write: true,
      decisions: adopt(newUp, ["skills/a/SKILL.md"]) };

    const report = syncComponent(args);

    expect(report.manual).toEqual([]);
    expect(report.written).toEqual(["updated: skills/a/SKILL.md"]);
    expect(readFileSync(join(local, "skills/a/SKILL.md"), "utf8")).toBe(
      "---\nname: a\ndescription: new words\nmenu-description: port menu line\n---\n\nShared body. AskUserQuestion early. New paragraph.\n",
    );

    const rerun = syncComponent(args);
    expect(rerun.written).toEqual([]);
    expect(rerun.candidates[0].disposition).toBe("aligned");
  });

  test("a new principle leaf lands with user-invocable: false and no Cursor flags", () => {
    const newUp = tree({
      "skills/principle-x/SKILL.md":
        "---\nname: principle-x\ndescription: a fresh principle\ndisable-model-invocation: true\n---\n\nPrinciple body.\n",
    });
    const local = tree({});
    const report = syncComponent({
      oldDir: tree({}),
      newDir: newUp,
      localDir: local,
      rules: RULES.substitutions,
      write: true,
      decisions: adopt(newUp, ["skills/principle-x/SKILL.md"]),
    });
    expect(report.written).toEqual(["added: skills/principle-x/SKILL.md"]);
    expect(readFileSync(join(local, "skills/principle-x/SKILL.md"), "utf8")).toBe(
      "---\nname: principle-x\ndescription: a fresh principle\nuser-invocable: false\n---\n\nPrinciple body.\n",
    );
  });

  test("write: false reports without touching the tree", () => {
    const oldUp = tree({ "s.md": "one\n" });
    const newUp = tree({ "s.md": "two\n" });
    const local = tree({ "s.md": "one\n" });
    const report = syncComponent({ oldDir: oldUp, newDir: newUp, localDir: local, rules: RULES.substitutions, write: false,
      decisions: adopt(newUp, ["s.md"]) });
    expect(report.planned).toEqual(["updated: s.md"]);
    expect(report.written).toEqual([]);
    expect(readFileSync(join(local, "s.md"), "utf8")).toBe("one\n");
  });
});

describe("sync CLI", () => {
  test("positional invocation previews without applying or advancing a pin", () => {
    expect(parseSyncArgs(["pstack", "e43c7ee"])).toMatchObject({ apply: false, finalize: false, json: false });
    expect(parseSyncArgs(["pstack", "e43c7ee", "--apply"])).toMatchObject({ apply: true, finalize: false });
    expect(parseSyncArgs(["pstack", "e43c7ee", "--finalize"])).toMatchObject({ apply: true, finalize: true });
  });

  test("bad flags and incomplete paths fail before any operation", () => {
    expect(() => parseSyncArgs(["pstack", "e43c7ee", "--merge"])).toThrow("unknown option");
    expect(() => parseSyncArgs(["pstack", "e43c7ee", "--review"])).toThrow("requires a path");
    expect(() => parseSyncArgs(["pstack", "HEAD"])).toThrow("usage:");
  });

  test("preview and failed finalization hold the pin; verified finalization preserves the old revision in its report", () => {
    const source = tree({ "pstack/a.md": "old\n" });
    const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-q");
    const commit = () => {
      git("add", ".");
      git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture");
      return git("rev-parse", "HEAD");
    };
    const from = commit();
    writeFileSync(join(source, "pstack/a.md"), "new\n");
    const to = commit();
    const upstream = { remote: source, components: { pstack: { upstreamPath: "pstack", localPath: "plugin", sha: from } } };
    const repository = tree({
      "tools/upstream.json": JSON.stringify(upstream),
      "tools/substitutions.json": JSON.stringify({ substitutions: [], denylist: [] }),
      "plugin/a.md": "old\n",
      "tools/generate.mjs": 'throw new Error("fixture verification failure");\n',
      "tests/skill-collision-repro.sh": "#!/bin/sh\nexit 0\n",
      "tests/fixture.test.mjs": 'import {test,expect} from "bun:test"; test("fixture",()=>expect(true).toBe(true));\n',
      "review.json": JSON.stringify({ components: { pstack: { from, to, decisions: [{ path: "a.md", revision: revision("new\n"), action: "adopt", reason: "verified fixture change" }] } } }),
    });
    const args = ["pstack", to, "--source", source, "--review", join(repository, "review.json")];
    const preview = main(args, repository);
    expect(preview.result.pinAdvanced).toBe(false);
    expect(readFileSync(join(repository, "plugin/a.md"), "utf8")).toBe("old\n");
    expect(() => main([...args, "--finalize"], repository)).toThrow();
    expect(JSON.parse(readFileSync(join(repository, "tools/upstream.json"))).components.pstack.sha).toBe(from);
    writeFileSync(join(repository, "tools/generate.mjs"), 'console.log("fixture verified");\n');
    const finalized = main([...args, "--finalize"], repository);
    expect(finalized.result).toMatchObject({ from, to, pinAdvanced: true });
    expect(JSON.parse(readFileSync(join(repository, "tools/upstream.json"))).components.pstack.sha).toBe(to);
    expect(readFileSync(join(repository, "plugin/a.md"), "utf8")).toBe("new\n");
    expect(main([...args, "--finalize"], repository).result).toMatchObject({ from: to, to, pinAdvanced: false, written: [] });
    const fork = join(tree({}), "clone");
    execFileSync("git", ["clone", "--quiet", source, fork]);
    writeFileSync(join(fork, "pstack/a.md"), "unregistered\n");
    execFileSync("git", ["-C", fork, "add", "."]);
    execFileSync("git", ["-C", fork, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "local only"]);
    const unreachable = execFileSync("git", ["-C", fork, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    writeFileSync(join(repository, "review.json"), JSON.stringify({ components: { pstack: { from: to, to: unreachable, decisions: [{ path: "a.md", revision: revision("unregistered\n"), action: "adopt", reason: "fixture" }] } } }));
    expect(() => main(["pstack", unreachable, "--source", fork, "--review", join(repository, "review.json"), "--finalize"], repository)).toThrow("registered upstream");
    expect(JSON.parse(readFileSync(join(repository, "tools/upstream.json"))).components.pstack.sha).toBe(to);
    expect(readFileSync(join(repository, "plugin/a.md"), "utf8")).toBe("new\n");
  });

  test("scheduled review has no repository mutation permissions", () => {
    const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../.github/workflows/sync-upstream.yml"), "utf8"));
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions).toBeUndefined();
      for (const step of job.steps) {
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with["persist-credentials"]).toBe(false);
        if (step.run) expect(step.run).not.toMatch(/gh pr merge|git push|--apply|--finalize/);
      }
    }
  });
});
