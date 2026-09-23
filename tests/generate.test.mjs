import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codexModelNamesSection, strayModelSlugs } from "../tools/generate.mjs";

const models = JSON.parse(readFileSync(join(import.meta.dir, "../plugins/pstack/models.json"), "utf8"));

describe("model policy", () => {
  test("routes GPT-6 roles without adding a simultaneous DeepSeek seat", () => {
    const roles = Object.fromEntries(models.roles.map(({ role, models }) => [role, models]));
    expect(models.singleRoleDefault).toBe("gpt-6-astra");
    expect(models.panel).toEqual(["gpt-6-astra", "gpt-6-sol", "grok-4.7"]);
    for (const role of ["feature, refactoring", "bug-fix", "perf-issue", "hillclimb"]) {
      expect(roles[role]).toEqual(["gpt-6-sol"]);
    }
    for (const role of ["how explorer", "why investigators", "reflect tooling", "swarm workers"]) {
      expect(roles[role]).toEqual(["gpt-6-luna"]);
    }
    for (const role of ["judgment and prose", "strongest judgment", "how explainer", "why synthesizer", "reflect judgment, divergent, synthesizer", "arena cross-judge pool"]) {
      expect(roles[role]).toEqual(["gpt-6-astra"]);
    }
    expect(roles["how critics"]).toBeUndefined();
    expect(roles["arena runners"]).toEqual(["gpt-6-sol", "grok-4.7"]);
    expect(roles["architect runners"]).toEqual(models.panel);
    expect(roles["interrogate reviewers"]).toEqual(["gpt-6-sol", "grok-4.7"]);
    expect(models.available.find(({ slug }) => slug === "deepseek-flash")).toEqual({ label: "DeepSeek Flash", slug: "deepseek-flash" });
    expect(models.available.find(({ slug }) => slug === "grok-4.7")?.spawn.codex).toBe("xai/grok-4.7");
  });

  test("resolves the canonical external seat from OpenCodex status", () => {
    const prose = codexModelNamesSection(models);
    expect(prose).toContain("`ocx agent status --json`");
    expect(prose).toContain("`.injection`");
    expect(prose).toContain("`multiAgentGuidanceEnabled`");
    expect(prose).toContain("`xai/grok-4.7`, `xai/grok-4.7-build-fast`, or `deepseek/deepseek-flash`");
    expect(prose).toContain("Otherwise skip that panel seat");
    expect(prose).toContain("`gpt-6-sol` becomes `ocx-gpt-6-sol`");
    expect(prose).toContain("`gpt-6-luna` becomes `ocx-gpt-6-luna`");
    expect(prose).not.toContain("ocx-deepseek-flash");
  });
});

describe("strayModelSlugs", () => {
  test("flags a deepseek slug outside a stamped region", () => {
    expect(strayModelSlugs("skills/x/SKILL.md", "use deepseek-flash here")).toEqual([
      "skills/x/SKILL.md:1: use deepseek-flash here",
    ]);
  });
});
