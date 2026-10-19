import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { applySubstitutions, denylistHits, main, parseSyncArgs, syncComponent } from "../tools/sync.mjs";

const RULES = JSON.parse(readFileSync(join(import.meta.dir, "../tools/substitutions.json"), "utf8"));
const POLICY = "policy:\n  allow_implicit_invocation: false\n";

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "sync-fixture-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

// One upstream git repository with a commit per snapshot of its pstack/ tree.
function upstreamRepo(...snapshots) {
  const source = tree({});
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  const shas = snapshots.map((files) => {
    rmSync(join(source, "pstack"), { recursive: true, force: true });
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(source, "pstack", rel, ".."), { recursive: true });
      writeFileSync(join(source, "pstack", rel), text);
    }
    git("add", "-A");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-q", "--allow-empty", "-m", "fixture");
    return git("rev-parse", "HEAD");
  });
  return { source, shas };
}

function portRepo({ sha, local, denylist = [], extra = {} }) {
  const component = {
    upstreamPath: "pstack",
    localPath: "plugin",
    sha,
    exclude: [{ pathPrefix: "agents/", reason: "fixture" }, { pathPrefix: ".cursor-plugin/", reason: "fixture" }],
    portOwned: [{ pathPrefix: "models.json", reason: "fixture" }],
    remap: [{ from: "agents/comment-sicko.md", to: "skills/no-comments/references/comment-sicko.md" }],
  };
  const files = Object.fromEntries(Object.entries(local).map(([rel, text]) => [join("plugin", rel), text]));
  return tree({
    "tools/upstream.json": JSON.stringify({ remote: "unused", components: { pstack: component } }),
    "tools/substitutions.json": JSON.stringify({ substitutions: RULES.substitutions, denylist }),
    ...files,
    ...extra,
  });
}

const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");
const pin = (repository) => JSON.parse(read(repository, "tools/upstream.json")).components.pstack.sha;

const OLD = {
  ".cursor-plugin/plugin.json": '{"version": "0.15.9"}\n',
  "models.json": '{"v": 1}\n',
  "notes.md": "same\n",
  "skills/a/SKILL.md": "---\nname: a\ndescription: a\n---\n\nOld a.\n",
  "skills/c/SKILL.md": "---\nname: c\ndescription: c\n---\n\nC body.\n",
  "skills/gone/SKILL.md": "---\nname: gone\ndescription: gone\ndisable-model-invocation: true\n---\n\nGone.\n",
};
const NEW = {
  ".cursor-plugin/plugin.json": '{"version": "0.15.27"}\n',
  "agents/comment-sicko.md": "Run on grok-4.7-xhigh-fast.\n",
  "agents/poteto-agent.md": "excluded\n",
  "models.json": '{"v": 2}\n',
  "notes.md": "same\n",
  "scripts/x.ts": 'const m = "grok-4.7-xhigh-fast";\n',
  "skills/a/SKILL.md": "---\nname: a\ndescription: a\ndisable-model-invocation: true\n---\n\nNew a on claude-opus-5-5-xhigh. Read ~/.cursor/rules/pstack-models.mdc.\n",
  "skills/b/SKILL.md": "---\nname: b\ndescription: b\n---\n\nB body.\n",
  "skills/c/SKILL.md": "---\nname: c\ndescription: c\n---\n\nC body.\n",
};
const LOCAL = {
  "models.json": '{"port": true}\n',
  "notes.md": "local drift\n",
  "skills/a/SKILL.md": "---\nname: a\ndescription: a\nmenu-description: port menu\n---\n\nPort edit of a.\n",
  "skills/c/SKILL.md": "---\nname: c\ndescription: c\n---\n\nC body.\n",
  "skills/c/agents/openai.yaml": POLICY,
  "skills/gone/SKILL.md": "---\nname: gone\ndescription: gone\n---\n\nGone.\n",
  "skills/gone/agents/openai.yaml": POLICY,
};

describe("mirror sync", () => {
  test("preview holds the tree and pin; apply mirrors upstream, keeps port-owned files, and derives invocation policy", () => {
    const { source, shas: [from, to] } = upstreamRepo(OLD, NEW);
    const repository = portRepo({ sha: from, local: LOCAL });
    const local = join(repository, "plugin");

    const preview = main(["pstack", to, "--source", source], repository);
    expect(preview).toMatchObject({ status: "changed", applied: false, pinAdvanced: false });
    expect(pin(repository)).toBe(from);
    expect(read(local, "skills/a/SKILL.md")).toBe(LOCAL["skills/a/SKILL.md"]);

    const applied = main(["pstack", to, "--source", source, "--apply"], repository);
    expect(applied).toEqual({
      component: "pstack",
      from,
      to,
      fromVersion: "0.15.9",
      toVersion: "0.15.27",
      status: "changed",
      changes: [
        { path: "skills/no-comments/references/comment-sicko.md", kind: "added" },
        { path: "scripts/x.ts", kind: "added" },
        { path: "skills/a/SKILL.md", kind: "updated" },
        { path: "skills/b/SKILL.md", kind: "added" },
        { path: "skills/gone/SKILL.md", kind: "deleted" },
        { path: "skills/a/agents/openai.yaml", kind: "added" },
        { path: "skills/c/agents/openai.yaml", kind: "deleted" },
        { path: "skills/gone/agents/openai.yaml", kind: "deleted" },
      ],
      portOwnedChanged: ["models.json"],
      warnings: [],
      counts: { "~/.cursor/rules/pstack-models.mdc": 1, "<role model>": 2 },
      unchanged: 2,
      excluded: 2,
      applied: true,
      pinAdvanced: true,
    });
    expect(pin(repository)).toBe(to);
    expect(read(local, "skills/a/SKILL.md")).toBe("---\nname: a\ndescription: a\nmenu-description: port menu\n---\n\nNew a on <role model>. Read ~/.codex/pstack-models.md.\n");
    expect(read(local, "skills/a/agents/openai.yaml")).toBe(POLICY);
    expect(read(local, "skills/no-comments/references/comment-sicko.md")).toBe("Run on <role model>.\n");
    expect(read(local, "scripts/x.ts")).toBe('const m = "grok-4.7-xhigh-fast";\n');
    expect(read(local, "models.json")).toBe('{"port": true}\n');
    expect(read(local, "notes.md")).toBe("local drift\n");
    expect(["skills/gone/SKILL.md", "skills/gone/agents/openai.yaml", "skills/c/agents/openai.yaml", "agents/poteto-agent.md"].filter((rel) => existsSync(join(local, rel)))).toEqual([]);

    expect(main(["pstack", to, "--source", source, "--apply"], repository)).toMatchObject({ status: "current", changes: [], pinAdvanced: false });

    const full = main(["pstack", to, "--source", source, "--full", "--apply"], repository);
    expect(full.changes).toEqual([
      { path: "skills/no-comments/references/comment-sicko.md", kind: "added" },
      { path: "notes.md", kind: "added" },
      { path: "scripts/x.ts", kind: "added" },
      { path: "skills/a/SKILL.md", kind: "added" },
      { path: "skills/b/SKILL.md", kind: "added" },
      { path: "skills/c/SKILL.md", kind: "added" },
    ]);
    expect(full).toMatchObject({ status: "changed", portOwnedChanged: ["models.json"], pinAdvanced: false });
    expect(read(local, "notes.md")).toBe("same\n");
    expect(pin(repository)).toBe(to);
  });

  test("a rendered denylist hit is a warning, not a failure, at the CLI", () => {
    const { source, shas: [from, to] } = upstreamRepo({ "notes.md": "same\n" }, { "notes.md": "same\n", "skills/a/SKILL.md": "---\nname: a\ndescription: a\n---\n\nUse control-ui.\n" });
    const repository = portRepo({ sha: from, local: { "notes.md": "same\n" }, denylist: [{ token: "control-ui", hint: "use a Codex driver" }] });
    const real = join(import.meta.dir, "..");
    for (const rel of ["tools/sync.mjs", "tools/generate.mjs", "plugins/pstack/skills/poteto-mode/scripts/route.mjs"]) {
      mkdirSync(join(repository, rel, ".."), { recursive: true });
      copyFileSync(join(real, rel), join(repository, rel));
    }
    const cli = (...args) => spawnSync(process.execPath, [join(repository, "tools/sync.mjs"), ...args], { encoding: "utf8" });

    const ok = cli("pstack", to, "--source", source, "--apply", "--json");
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout).warnings).toEqual(['skills/a/SKILL.md:6: "control-ui" — use a Codex driver']);
    expect(read(repository, "plugin/skills/a/SKILL.md")).toBe("---\nname: a\ndescription: a\n---\n\nUse control-ui.\n");

    const failed = cli("missing", to, "--source", source);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toBe("FAIL: unknown component: missing\n");
  });

  test("a sync target behind a symlink is rejected before anything is written", () => {
    const localDir = tree({});
    const outside = join(tree({}), "outside.md");
    symlinkSync(outside, join(localDir, "a.md"));
    expect(() => syncComponent({ oldDir: tree({}), newDir: tree({ "a.md": "new\n", "b.md": "b\n" }), localDir, rules: [], apply: true })).toThrow("symlink is not a sync target");
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(join(localDir, "b.md"))).toBe(false);
  });

  test("a new principle leaf lands with user-invocable: false and no Cursor flags", () => {
    const localDir = tree({});
    syncComponent({
      oldDir: tree({}),
      newDir: tree({ "skills/principle-x/SKILL.md": "---\nname: principle-x\ndescription: a fresh principle\ndisable-model-invocation: true\n---\n\nPrinciple body.\n" }),
      localDir,
      rules: [],
      apply: true,
    });
    expect(read(localDir, "skills/principle-x/SKILL.md")).toBe("---\nname: principle-x\ndescription: a fresh principle\nuser-invocable: false\n---\n\nPrinciple body.\n");
  });

  test.each([
    ["scripts/engine.wasm", Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])],
    ["scripts/blob.dat", Buffer.from([0xff, 0xfe, 0x80])],
  ])("%s with an unlisted extension passes through byte for byte", (rel, header) => {
    const payload = Buffer.concat([header, Buffer.from(" ~/.cursor/skills/ control-cli\n")]);
    const localDir = tree({});
    const report = syncComponent({ oldDir: tree({}), newDir: tree({ [rel]: payload }), localDir, rules: RULES.substitutions, apply: true, denylist: RULES.denylist });
    expect(readFileSync(join(localDir, rel))).toEqual(payload);
    expect(report).toMatchObject({ changes: [{ path: rel, kind: "added" }], warnings: [] });
    expect(report.counts.size).toBe(0);
  });
});

describe("applySubstitutions", () => {
  test("rewrites Cursor paths to Codex paths and counts per rule", () => {
    const { text, counts } = applySubstitutions(
      "Rules in ~/.cursor/rules/pstack-models.mdc. Skills in ~/.cursor/skills/ and .cursor/skills/. Plugins in ~/.cursor/plugins/pstack.",
      RULES.substitutions,
    );
    expect(text).toBe("Rules in ~/.codex/pstack-models.md. Skills in ~/.agents/skills/ and .agents/skills/. Plugins in ~/.codex/plugins/cache/pstack.");
    expect(Object.fromEntries(counts)).toEqual({
      "~/.cursor/rules/pstack-models.mdc": 1,
      "~/.cursor/skills/": 1,
      ".cursor/skills/": 1,
      "~/.cursor/plugins/": 1,
    });
  });
});

describe("denylistHits", () => {
  test("flags residual Cursor-isms with file, line, and hint", () => {
    expect(denylistHits("skills/x/SKILL.md", "line one\nrun control-cli now\n", RULES.denylist)).toEqual([
      'skills/x/SKILL.md:2: "control-cli" — drive CLIs/TUIs with exec_command PTY sessions per codex-tools.md',
    ]);
  });
});

describe("sync CLI arguments", () => {
  test("flags parse into options", () => {
    expect(parseSyncArgs(["pstack", "e43c7ee"])).toEqual({ component: "pstack", sha: "e43c7ee", apply: false, full: false, json: false, source: null });
    expect(parseSyncArgs(["pstack", "e43c7ee", "--apply", "--full", "--json", "--source", "/tmp/up"])).toEqual({ component: "pstack", sha: "e43c7ee", apply: true, full: true, json: true, source: "/tmp/up" });
  });

  test("bad flags and incomplete paths fail before any operation", () => {
    expect(() => parseSyncArgs(["pstack", "e43c7ee", "--finalize"])).toThrow("unknown option: --finalize");
    expect(() => parseSyncArgs(["pstack", "e43c7ee", "--source"])).toThrow("--source requires a path");
    expect(() => parseSyncArgs(["pstack", "HEAD"])).toThrow("usage:");
  });
});
