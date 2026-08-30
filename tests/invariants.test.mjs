// Proves each static invariant in skill-collision-repro.sh still fails when it
// should. A check that quietly matches nothing looks identical to a pass, and
// that already happened once (the 0.9.10 quad check hunted a retired slug for
// a whole release), so every check gets a fixture that must trip it.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "skill-collision-repro.sh");

const CODEX_DISPATCH_CONTRACT = `# Codex tools

## Codex spawn contract

\`\`\`json
{
  "agent_type": "default",
  "task_name": "<semantic role>",
  "model": "<configured model>",
  "reasoning_effort": "<configured effort>",
  "fork_turns": "none",
  "prompt": "<complete task, constraints, and file pointers>"
}
\`\`\`
`;

function skill(dir, name, front) {
  mkdirSync(join(dir, "plugins/pstack/skills", name), { recursive: true });
  writeFileSync(
    join(dir, "plugins/pstack/skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: fixture\n${front}---\n\nbody\n`,
  );
}

function codexTools(dir, text = CODEX_DISPATCH_CONTRACT) {
  const path = join(dir, "plugins/pstack/skills/poteto-mode/references/codex-tools.md");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function fixture(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "invariants-"));
  skill(dir, "good", "");
  skill(dir, "principle-good", "user-invocable: false\n");
  codexTools(dir);
  mutate(dir);
  return dir;
}

function run(dir) {
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    env: { ...process.env, PSTACK_REPO: dir, SKIP_BEHAVIORAL: "1" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("skill-collision-repro.sh static invariants", () => {
  test("a clean tree passes", () => {
    const { code, out } = run(fixture());
    expect(code).toBe(0);
    expect(out).not.toContain("FAIL:");
  });

  test("a commands/ directory fails", () => {
    const { code, out } = run(fixture((d) => mkdirSync(join(d, "plugins/pstack/commands"), { recursive: true })));
    expect(code).toBe(1);
    expect(out).toContain("FAIL: no plugins/pstack/commands/ directory");
  });

  test("disable-model-invocation on a skill fails and names the file", () => {
    const { code, out } = run(fixture((d) => skill(d, "flagged", "disable-model-invocation: true\n")));
    expect(code).toBe(1);
    expect(out).toContain("FAIL: no skill carries disable-model-invocation: true");
    expect(out).toContain("skills/flagged/SKILL.md");
  });

  test("a principle leaf missing user-invocable: false fails", () => {
    const { code, out } = run(fixture((d) => skill(d, "principle-visible", "")));
    expect(code).toBe(1);
    expect(out).toContain("FAIL: principle-* leaves");
    expect(out).toContain("principle-visible/SKILL.md (missing user-invocable: false)");
  });

  test("a principle leaf carrying disable-model-invocation fails", () => {
    const { code, out } = run(
      fixture((d) => skill(d, "principle-dead", "user-invocable: false\ndisable-model-invocation: true\n")),
    );
    expect(code).toBe(1);
    expect(out).toContain("principle-dead/SKILL.md (still carries disable-model-invocation)");
  });

  test("the body of a skill may mention the flag in prose", () => {
    const dir = fixture();
    writeFileSync(
      join(dir, "plugins/pstack/skills/good/SKILL.md"),
      "---\nname: good\ndescription: fixture\n---\n\nNever set disable-model-invocation: true on a skill.\n",
    );
    expect(run(dir).code).toBe(0);
  });

  test("a semantic Codex agent type fails", () => {
    const dir = fixture((d) => codexTools(d, CODEX_DISPATCH_CONTRACT.replace('"default"', '"reviewer"')));
    const { code, out } = run(dir);
    expect(code).toBe(1);
    expect(out).toContain("FAIL: Codex pstack dispatch uses the default agent with explicit policy");
    expect(out).toContain("agent_type must be default");
  });

  test.each([
    ["task name", '  "task_name": "<semantic role>",\n', "task_name must carry the semantic role"],
    ["model", '  "model": "<configured model>",\n', "model must be explicit"],
    ["reasoning effort", '  "reasoning_effort": "<configured effort>",\n', "reasoning_effort must be explicit"],
    ["fork turns", '  "fork_turns": "none",\n', "fork_turns must be explicit"],
  ])("a missing Codex %s fails", (_name, field, expected) => {
    const dir = fixture((d) => codexTools(d, CODEX_DISPATCH_CONTRACT.replace(field, "")));
    const { code, out } = run(dir);
    expect(code).toBe(1);
    expect(out).toContain("FAIL: Codex pstack dispatch uses the default agent with explicit policy");
    expect(out).toContain(expected);
  });
});
