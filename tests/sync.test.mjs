import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySubstitutions, denylistHits, syncComponent } from "../tools/sync.mjs";

const RULES = JSON.parse(readFileSync(join(import.meta.dir, "../tools/substitutions.json"), "utf8"));

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "sync-fixture-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

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

    const report = syncComponent({ oldDir: oldUp, newDir: newUp, localDir: local, rules: RULES.substitutions, write: true });

    expect(report.written).toContain("updated: skills/a/SKILL.md");
    expect(report.written).toContain("added: skills/c/SKILL.md");
    expect(report.manual).toEqual(["skills/b/SKILL.md"]);
    expect(readFileSync(join(local, "skills/a/SKILL.md"), "utf8")).toBe(
      "Step 1: AskUserQuestion about scope. Step 2: verify.\n",
    );
    expect(readFileSync(join(local, "skills/c/SKILL.md"), "utf8")).toBe("Brand new skill. AskUserQuestion early.\n");
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
    const args = { oldDir: oldUp, newDir: newUp, localDir: local, rules: RULES.substitutions, write: true };

    const report = syncComponent(args);

    expect(report.manual).toEqual([]);
    expect(report.written).toEqual(["updated: skills/a/SKILL.md"]);
    expect(readFileSync(join(local, "skills/a/SKILL.md"), "utf8")).toBe(
      "---\nname: a\ndescription: new words\nmenu-description: port menu line\n---\n\nShared body. AskUserQuestion early. New paragraph.\n",
    );

    const rerun = syncComponent(args);
    expect(rerun.written).toEqual([]);
    expect(rerun.unchanged).toBe(1);
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
    const report = syncComponent({ oldDir: oldUp, newDir: newUp, localDir: local, rules: RULES.substitutions, write: false });
    expect(report.written).toEqual(["updated: s.md"]);
    expect(readFileSync(join(local, "s.md"), "utf8")).toBe("one\n");
  });
});
