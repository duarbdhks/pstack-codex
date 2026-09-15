import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codexModelNamesSection, strayModelSlugs } from "../tools/generate.mjs";

const models = JSON.parse(readFileSync(join(import.meta.dir, "../plugins/pstack/models.json"), "utf8"));

describe("codexModelNamesSection", () => {
  test("lists a 4-seat panel and remaps only", () => {
    expect(models.panel).toHaveLength(4);
    expect(models.panel).toContain("deepseek-flash");

    const prose = codexModelNamesSection(models);
    expect(prose).toContain("`deepseek-flash`");
    expect(prose).toContain("`gpt-6-astra`, `gpt-5.6-luna`, `grok-4.6`, `deepseek-flash`");
    expect(prose).toContain("`grok-4.6` becomes `xai/grok-4.6`");
    expect(prose).toContain("`gpt-6-astra` becomes `ocx-gpt-6-astra`");
    expect(prose).toContain("`gpt-5.6-luna` becomes `ocx-gpt-5-6-luna`");
    expect(prose).not.toContain("ocx-deepseek-flash");
    expect(prose).not.toContain("`deepseek-flash` becomes");
    expect(prose).not.toContain("`deepseek-flash` stays");
  });
});

describe("strayModelSlugs", () => {
  test("flags a deepseek slug outside a stamped region", () => {
    expect(strayModelSlugs("skills/x/SKILL.md", "use deepseek-flash here")).toEqual([
      "skills/x/SKILL.md:1: use deepseek-flash here",
    ]);
  });
});
