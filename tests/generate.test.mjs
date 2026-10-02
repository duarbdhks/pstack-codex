import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codexModelNamesSection, setupModelsSection, strayModelSlugs } from "../tools/generate.mjs";

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
    expect(prose).toContain("`gpt-6.1-sol` becomes `ocx-gpt-6-1-sol`");
    expect(prose).toContain("`gpt-6-luna` becomes `ocx-gpt-6-luna`");
    expect(prose).not.toContain("ocx-deepseek-flash");
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

describe("strayModelSlugs", () => {
  test("flags a deepseek slug outside a stamped region", () => {
    expect(strayModelSlugs("skills/x/SKILL.md", "use deepseek-flash here")).toEqual([
      "skills/x/SKILL.md:1: use deepseek-flash here",
    ]);
  });
});
