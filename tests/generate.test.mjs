import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { codexModelNamesSection, dispatchProfilesSection, legacyModelNamesSection, setupModelsSection, strayModelSlugs, validateRoutingCatalog } from "../tools/generate.mjs";

const models = JSON.parse(readFileSync(join(import.meta.dir, "../plugins/pstack/models.json"), "utf8"));

describe("model policy", () => {
  test("routes GPT-6 roles without adding a simultaneous DeepSeek seat", () => {
    const roles = Object.fromEntries(models.roles.map(({ role, models }) => [role, models]));
    expect(models.singleRoleDefault).toBe("gpt-6-astra");
    expect(models.panel).toEqual(["gpt-6-astra", "gpt-6.1-sol", "grok-4.7"]);
    for (const role of ["feature, refactoring", "bug-fix", "perf-issue", "hillclimb"]) {
      expect(roles[role]).toEqual(["gpt-6.1-sol"]);
    }
    for (const role of ["how explorer", "why investigators", "reflect tooling", "swarm workers"]) {
      expect(roles[role]).toEqual(["gpt-6-luna"]);
    }
    for (const role of ["judgment and prose", "strongest judgment", "how explainer", "why synthesizer", "reflect judgment, divergent, synthesizer", "arena cross-judge pool"]) {
      expect(roles[role]).toEqual(["gpt-6-astra"]);
    }
    expect(roles["how critics"]).toBeUndefined();
    expect(roles["arena runners"]).toEqual(["gpt-6.1-sol", "grok-4.7"]);
    expect(roles["architect runners"]).toEqual(models.panel);
    expect(roles["interrogate reviewers"]).toEqual(["gpt-6.1-sol", "grok-4.7"]);
    expect(models.available.find(({ slug }) => slug === "deepseek-flash")).toEqual({ label: "DeepSeek Flash", slug: "deepseek-flash" });
    expect(models.available.find(({ slug }) => slug === "grok-4.7")?.spawn.codex).toBe("xai/grok-4.7");
    expect(models.available.find(({ slug }) => slug === "anthropic/claude-opus-5-5")).toEqual({ label: "Claude Opus 5.5", slug: "anthropic/claude-opus-5-5" });
    expect(setupModelsSection(models)).toContain("Claude Opus 5.5 (`anthropic/claude-opus-5-5`)");
  });

  test("routes every Codex role and panel slot through the shared policy", () => {
    const prose = codexModelNamesSection(models);
    expect(prose).toContain("every role and panel slot");
    expect(prose).toContain("`~/.codex/AGENTS.md`");
    expect(prose).toContain("`~/.codex/pstack-models.md`");
    expect(prose).toContain("model and effort unchanged");
    expect(prose).toContain("Preserve all panel slots");
    expect(prose).not.toContain("Otherwise skip that panel seat");
    expect(prose).not.toContain("xai/grok-4.7-build-fast");
    expect(prose).toContain("Adaptive selections");
    expect(prose).not.toContain("ocx-gpt-6-1-sol");
    const legacy = legacyModelNamesSection(models);
    expect(legacy).toContain("`gpt-6.1-sol` becomes `ocx-gpt-6-1-sol`");
    expect(legacy).toContain("`gpt-6-luna` becomes `ocx-gpt-6-luna`");
    expect(legacy).not.toContain("ocx-deepseek-flash");
  });

  test("Codex setup preserves YAML selections instead of applying the Claude template", () => {
    const skill = readFileSync(join(import.meta.dir, "../plugins/pstack/skills/setup-pstack/SKILL.md"), "utf8");
    const codex = skill.split("## Codex\n")[1]?.split("## Claude Code\n")[0] ?? "";
    expect(codex).toContain("`source: ocx`");
    expect(codex).toContain("fallback");
    expect(codex).toContain("role order");
    expect(codex).toContain("panel slots");
    expect(codex).toContain("`defaults.judgment`");
    expect(codex).toContain("`defaults.evidence`");
    expect(codex).toContain("Do not apply the Claude Code template below");
  });
});

describe("routing catalog generation", () => {
  test("profiles and role references are generated from a validated catalog", () => {
    expect(() => validateRoutingCatalog(models)).not.toThrow();
    const table = dispatchProfilesSection(models);
    expect(table).toContain("| evidence | `gpt-6-luna` / `medium` | `gpt-6-luna` / `high` | `gpt-6.1-sol` / `high` |");
    const missing = structuredClone(models);
    delete missing.codexRouting.profiles.evidence;
    expect(() => validateRoutingCatalog(missing)).toThrow("missing profile");
    const unknown = structuredClone(models);
    unknown.codexRouting.profiles.evidence[0].model = "unlisted";
    expect(() => validateRoutingCatalog(unknown)).toThrow("uncatalogued model");
    const wrongRole = structuredClone(models);
    wrongRole.roles[0].profile = "unknown";
    expect(() => validateRoutingCatalog(wrongRole)).toThrow("unknown profile");
  });

  test("the real generator updates the shipped catalog, is idempotent, and supports independent skill copies", () => {
    const repository = join(import.meta.dir, "..");
    const fixture = mkdtempSync(join(tmpdir(), "pstack-generation-"));
    const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: repository, encoding: "utf8" }).split("\0").filter(Boolean);
    for (const path of new Set(files)) {
      if (!existsSync(join(repository, path))) continue;
      mkdirSync(dirname(join(fixture, path)), { recursive: true });
      copyFileSync(join(repository, path), join(fixture, path));
    }
    const modelPath = join(fixture, "plugins/pstack/models.json");
    const changed = JSON.parse(readFileSync(modelPath, "utf8"));
    changed.codexRouting.profiles.implementation[0].effort = "high";
    writeFileSync(modelPath, JSON.stringify(changed));
    const generate = () => execFileSync(process.execPath, ["tools/generate.mjs"], { cwd: fixture, stdio: ["ignore", "pipe", "pipe"] });
    generate();
    const bundled = join(fixture, "plugins/pstack/skills/poteto-mode/scripts/models.generated.json");
    expect(JSON.parse(readFileSync(bundled, "utf8"))).toEqual(changed);
    expect(readFileSync(join(fixture, "plugins/pstack/skills/poteto-mode/references/codex-routing.md"), "utf8")).toContain("| implementation | `gpt-6.1-sol` / `high`");
    const digests = () => files.filter((path) => existsSync(join(fixture, path))).map((path) => [path, createHash("sha256").update(readFileSync(join(fixture, path))).digest("hex")]);
    const before = digests();
    generate();
    expect(digests()).toEqual(before);
    const standalone = join(fixture, "standalone");
    mkdirSync(standalone);
    const scripts = join(fixture, "plugins/pstack/skills/poteto-mode/scripts");
    for (const path of ["route.mjs", "models.generated.json"]) copyFileSync(join(scripts, path), join(standalone, path));
    const config = join(standalone, "pstack-models.md");
    writeFileSync(config, '```yaml\nroles:\n  bug-fix: {model: gpt-6.1-sol, effort: high}\n```\n');
    const output = execFileSync(process.execPath, [join(standalone, "route.mjs"), "resolve", "--config", config], {
      input: JSON.stringify({ contract: { "gpt-6.1-sol": ["high"] }, entries: [{ role: "bug-fix", message: "inspect this isolated fixture" }] }),
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    expect(JSON.parse(output).entries[0].spawn).toEqual({ agent_type: "default", task_name: "bug-fix", model: "gpt-6.1-sol", reasoning_effort: "high", fork_turns: "none", message: "inspect this isolated fixture" });
  });
});

describe("strayModelSlugs", () => {
  test("flags a deepseek slug outside a stamped region", () => {
    expect(strayModelSlugs("skills/x/SKILL.md", "use deepseek-flash here")).toEqual([
      "skills/x/SKILL.md:1: use deepseek-flash here",
    ]);
  });
});
