import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GENERATED_CATALOG_PATH,
  POLICY_MARKER,
  SOURCE_CATALOG_PATH,
  contractDigest,
  defaultCatalogPath,
  policyAllowsAdaptive,
  escalate,
  readOcx,
  resolveBatch,
  verify,
} from "../plugins/pstack/skills/poteto-mode/scripts/route.mjs";

const script = join(import.meta.dir, "../plugins/pstack/skills/poteto-mode/scripts/route.mjs");
const catalog = JSON.parse(readFileSync(join(import.meta.dir, "../plugins/pstack/models.json"), "utf8"));

const CONTRACT = {
  "gpt-6-luna": ["medium", "high", "max"],
  "gpt-6.1-sol": ["medium", "high", "xhigh"],
  "gpt-6-astra": ["high", "xhigh"],
  "xai/grok-4.7": ["high"],
};
const LUNA_HIGH = { model: "gpt-6-luna", effort: "high" };
const SOL_HIGH = { model: "gpt-6.1-sol", effort: "high" };
const SOL_XHIGH = { model: "gpt-6.1-sol", effort: "xhigh" };
const ASTRA_XHIGH = { model: "gpt-6-astra", effort: "xhigh" };
const OCX_OFF = { ok: false, reason: "OCX proxy is not running" };
const OCX_ON = { ok: true, ...SOL_HIGH };
const ROUTINE = { difficulty: "routine", failureCost: "low", reasoningDepth: "shallow" };

const SHEET = {
  defaults: {
    judgment: { source: "ocx", fallback: ASTRA_XHIGH },
    evidence: { source: "ocx", fallback: { model: "gpt-6-luna", effort: "max" } },
  },
  roles: {
    "bug-fix": { source: "ocx", fallback: SOL_XHIGH },
    "architect runners": [
      { source: "ocx", fallback: ASTRA_XHIGH },
      { source: "ocx", fallback: SOL_XHIGH },
      { source: "ocx", fallback: SOL_XHIGH },
    ],
    "interrogate reviewers": [SOL_HIGH, { model: "xai/grok-4.7", effort: "high" }],
  },
};

const resolve = (request, ocx = OCX_OFF) => resolveBatch({ contract: CONTRACT, ...request }, { catalog, ocx: typeof ocx === "function" ? ocx : () => ocx });
const pairs = (result) => result.entries.map((e) => [e.source, e.requested.model, e.requested.effort]);

describe("models.json codexRouting", () => {
  test("ships version 1 profiles over the exact catalog and keeps roles and panels", () => {
    expect(catalog.codexRouting).toEqual({
      version: 1,
      profiles: {
        evidence: [{ model: "gpt-6-luna", effort: "medium" }, LUNA_HIGH, SOL_HIGH],
        implementation: [{ model: "gpt-6.1-sol", effort: "medium" }, SOL_HIGH, { model: "gpt-6-astra", effort: "high" }],
        judgment: [SOL_HIGH, { model: "gpt-6-astra", effort: "high" }, ASTRA_XHIGH],
      },
    });
    const profiles = Object.fromEntries(catalog.roles.map((r) => [r.role, r.profile]));
    expect(profiles).toEqual({
      "feature, refactoring": "implementation",
      "bug-fix": "implementation",
      "perf-issue": "implementation",
      hillclimb: "implementation",
      "judgment and prose": "judgment",
      "strongest judgment": "judgment",
      "how explorer": "evidence",
      "how explainer": "judgment",
      "why investigators": "evidence",
      "why synthesizer": "judgment",
      "reflect tooling": "evidence",
      "reflect judgment, divergent, synthesizer": "judgment",
      "arena runners": "implementation",
      "arena cross-judge pool": "judgment",
      "swarm workers": "evidence",
      "architect runners": "judgment",
      "interrogate reviewers": "judgment",
    });
    expect(catalog.panel).toEqual(["gpt-6-astra", "gpt-6.1-sol", "grok-4.7"]);
  });

  test("the default loader prefers the generated sibling and falls back to the source", () => {
    const scripts = join(import.meta.dir, "../plugins/pstack/skills/poteto-mode/scripts");
    expect(GENERATED_CATALOG_PATH).toBe(join(scripts, "models.generated.json"));
    expect(SOURCE_CATALOG_PATH).toBe(join(import.meta.dir, "../plugins/pstack/models.json"));
    expect(defaultCatalogPath((path) => path === GENERATED_CATALOG_PATH)).toBe(GENERATED_CATALOG_PATH);
    expect(defaultCatalogPath(() => false)).toBe(SOURCE_CATALOG_PATH);
  });
});

describe("adaptive tiers", () => {
  const TIERS = [
    ["routine", "low", "shallow", 0],
    ["routine", "low", "standard", 1],
    ["routine", "low", "deep", 2],
    ["routine", "medium", "shallow", 1],
    ["routine", "medium", "standard", 1],
    ["routine", "medium", "deep", 2],
    ["routine", "high", "shallow", 2],
    ["routine", "high", "standard", 2],
    ["routine", "high", "deep", 2],
    ["bounded", "low", "shallow", 1],
    ["bounded", "low", "standard", 1],
    ["bounded", "low", "deep", 2],
    ["bounded", "medium", "shallow", 1],
    ["bounded", "medium", "standard", 1],
    ["bounded", "medium", "deep", 2],
    ["bounded", "high", "shallow", 2],
    ["bounded", "high", "standard", 2],
    ["bounded", "high", "deep", 2],
    ["complex", "low", "shallow", 2],
    ["complex", "low", "standard", 2],
    ["complex", "low", "deep", 2],
    ["complex", "medium", "shallow", 2],
    ["complex", "medium", "standard", 2],
    ["complex", "medium", "deep", 2],
    ["complex", "high", "shallow", 2],
    ["complex", "high", "standard", 2],
    ["complex", "high", "deep", 2],
  ];
  const IMPLEMENTATION = [
    { model: "gpt-6.1-sol", effort: "medium" },
    SOL_HIGH,
    { model: "gpt-6-astra", effort: "high" },
  ];

  test("covers all 27 task combinations", () => {
    expect(new Set(TIERS.map((row) => row.slice(0, 3).join("/"))).size).toBe(27);
  });

  test.each(TIERS)("%s / %s / %s -> tier %i", (difficulty, failureCost, reasoningDepth, tier) => {
    const task = { difficulty, failureCost, reasoningDepth };
    const result = resolve({ adaptiveAllowed: true, entries: [{ role: "bug-fix", task }] });
    expect(result.ok).toBe(true);
    expect(result.entries[0]).toMatchObject({ source: "adaptive", profile: "implementation", tier, requested: IMPLEMENTATION[tier] });
  });
});

describe("resolveBatch", () => {
  test("no sheet plus adaptiveAllowed routes every catalog panel slot and builds the spawn payload", () => {
    const task = { difficulty: "complex", failureCost: "high", reasoningDepth: "deep" };
    const result = resolve({ adaptiveAllowed: true, entries: [{ role: "architect runners", task, message: "design it" }, { role: "swarm workers", task: ROUTINE }] });
    expect(result.ok).toBe(true);
    expect(result.contractDigest).toBe(contractDigest(CONTRACT));
    expect(result.entries.map((e) => [e.role, e.slot, e.slots, e.tier])).toEqual([
      ["architect runners", 0, 3, 2],
      ["architect runners", 1, 3, 2],
      ["architect runners", 2, 3, 2],
      ["swarm workers", 0, 1, 0],
    ]);
    expect(result.entries[0]).toEqual({
      index: 0,
      role: "architect runners",
      slot: 0,
      slots: 3,
      profile: "judgment",
      source: "adaptive",
      tier: 2,
      escalation: 0,
      requested: ASTRA_XHIGH,
      task,
      contractDigest: contractDigest(CONTRACT),
      spawn: { agent_type: "default", task_name: "architect runners", model: "gpt-6-astra", reasoning_effort: "xhigh", fork_turns: "none", message: "design it" },
    });
    expect("message" in result.entries[3].spawn).toBe(false);
  });

  test("no sheet without adaptive authorization is an error", () => {
    const result = resolve({ entries: [{ role: "bug-fix", task: ROUTINE }] });
    expect(result).toEqual({ ok: false, errors: ["entries[0]: no model sheet exists and adaptive routing is not authorized"] });
  });

  test("a role missing from an existing sheet uses defaults, never adaptive", () => {
    const result = resolve({
      config: SHEET,
      adaptiveAllowed: true,
      entries: [{ role: "swarm workers", task: ROUTINE }, { role: "hillclimb", task: ROUTINE }, { role: "evidence" }, { role: "judgment" }],
    });
    expect(pairs(result)).toEqual([
      ["fallback", "gpt-6-luna", "max"],
      ["fallback", "gpt-6-astra", "xhigh"],
      ["fallback", "gpt-6-luna", "max"],
      ["fallback", "gpt-6-astra", "xhigh"],
    ]);
    expect(result.entries.map((e) => e.profile)).toEqual(["evidence", "implementation", "evidence", "judgment"]);
  });

  test("an opted-in implementation default uses its own minimum tier", () => {
    const config = { ...SHEET, defaults: { ...SHEET.defaults, implementation: { source: "adaptive", profile: "implementation" } } };
    const result = resolve({ config, adaptiveAllowed: true, entries: [{ role: "hillclimb", task: ROUTINE }] });
    expect(result.entries[0]).toMatchObject({ source: "adaptive", profile: "implementation", tier: 0, requested: { model: "gpt-6.1-sol", effort: "medium" } });
  });

  test("an unknown role outside sheet and catalog is an error", () => {
    expect(resolve({ config: SHEET, entries: [{ role: "mystery" }] }).errors).toEqual([
      'entries[0]: role "mystery" is in neither the sheet nor the catalog',
    ]);
  });

  test("OCX copies the injection pair into every panel slot and reads status once per batch", () => {
    let reads = 0;
    const ocx = () => (reads++, OCX_ON);
    const result = resolve({ config: SHEET, entries: [{ role: "architect runners" }, { role: "bug-fix" }] }, ocx);
    expect(reads).toBe(1);
    expect(pairs(result)).toEqual([
      ["ocx", "gpt-6.1-sol", "high"],
      ["ocx", "gpt-6.1-sol", "high"],
      ["ocx", "gpt-6.1-sol", "high"],
      ["ocx", "gpt-6.1-sol", "high"],
    ]);
  });

  test("unavailable OCX restores each slot's own fallback and reports the reason", () => {
    const result = resolve({ config: SHEET, entries: [{ role: "architect runners" }] });
    expect(pairs(result)).toEqual([
      ["fallback", "gpt-6-astra", "xhigh"],
      ["fallback", "gpt-6.1-sol", "xhigh"],
      ["fallback", "gpt-6.1-sol", "xhigh"],
    ]);
    expect(result.entries.every((e) => e.reason === "OCX proxy is not running")).toBe(true);
  });

  test("a cross-judge pool requires a choice and does not fan out its candidates", () => {
    const config = { roles: { "arena cross-judge pool": [SOL_HIGH, ASTRA_XHIGH, SOL_HIGH] } };
    expect(resolve({ config, entries: [{ role: "arena cross-judge pool" }] }).ok).toBe(false);
    const chosen = resolve({ config, entries: [{ role: "arena cross-judge pool", choice: 1 }] });
    expect(chosen.entries).toHaveLength(1);
    expect(chosen.entries[0]).toMatchObject({ slot: 1, slots: 3, pool: true, requested: ASTRA_XHIGH });
    expect(resolve({ config, entries: [{ role: "arena cross-judge pool", choice: 3 }] }).ok).toBe(false);
    expect(resolve({ config: SHEET, entries: [{ role: "architect runners", choice: 0 }] }).ok).toBe(false);
  });

  test("an OCX injection outside the request contract falls back", () => {
    const result = resolve({ config: SHEET, entries: [{ role: "bug-fix" }] }, { ok: true, model: "anthropic/claude-opus-5-5", effort: "high" });
    expect(result.entries[0]).toMatchObject({ source: "fallback", requested: SOL_XHIGH, reason: "OCX injection anthropic/claude-opus-5-5/high is not supported by the request contract" });
  });

  test("the fallback is validated even when OCX works", () => {
    const sheet = { roles: { "bug-fix": { source: "ocx", fallback: { model: "gpt-6-astra", effort: "medium" } } } };
    expect(resolve({ config: sheet, entries: [{ role: "bug-fix" }] }, OCX_ON).errors).toEqual([
      "entries[0]: OCX fallback gpt-6-astra/medium is not supported by the request contract",
    ]);
  });

  test("fixed selections are checked against the request contract, not the catalog", () => {
    const result = resolve({ config: SHEET, entries: [{ role: "interrogate reviewers" }] }, OCX_ON);
    expect(pairs(result)).toEqual([
      ["fixed", "gpt-6.1-sol", "high"],
      ["fixed", "xai/grok-4.7", "high"],
    ]);
    const narrow = resolveBatch({ contract: { "gpt-6.1-sol": ["high"] }, config: SHEET, entries: [{ role: "interrogate reviewers" }] }, { catalog, ocx: OCX_ON });
    expect(narrow.errors).toEqual(["entries[0]: fixed selection xai/grok-4.7/high is not supported by the request contract"]);
  });

  test("an explicit user pair beats the sheet and adaptive routing for every slot", () => {
    let reads = 0;
    const result = resolve({ config: SHEET, adaptiveAllowed: true, entries: [{ role: "architect runners", user: LUNA_HIGH }] }, () => (reads++, OCX_ON));
    expect(reads).toBe(0);
    expect(pairs(result)).toEqual([
      ["user", "gpt-6-luna", "high"],
      ["user", "gpt-6-luna", "high"],
      ["user", "gpt-6-luna", "high"],
    ]);
    expect(resolve({ entries: [{ role: "bug-fix", user: { model: "gpt-6-luna", effort: "xhigh" } }] }).errors).toEqual([
      "entries[0]: user selection gpt-6-luna/xhigh is not supported by the request contract",
    ]);
  });

  test("adaptive tiers outside the request contract are rejected, not substituted", () => {
    const result = resolveBatch(
      { contract: { "gpt-6.1-sol": ["high"] }, adaptiveAllowed: true, entries: [{ role: "bug-fix", task: ROUTINE }] },
      { catalog, ocx: () => OCX_OFF },
    );
    expect(result.errors).toEqual(["entries[0]: adaptive implementation tier 0 gpt-6.1-sol/medium is not supported by the request contract"]);
  });

  test("a sheet's source: adaptive needs adaptiveAllowed and may name a profile", () => {
    const sheet = { defaults: {}, roles: { "how explorer": { source: "adaptive", profile: "judgment" } } };
    expect(resolve({ config: sheet, entries: [{ role: "how explorer", task: ROUTINE }] }).errors).toEqual([
      "entries[0]: adaptive selection requires adaptiveAllowed",
    ]);
    const allowed = resolve({ config: sheet, adaptiveAllowed: true, entries: [{ role: "how explorer", task: ROUTINE }] });
    expect(allowed.entries[0]).toMatchObject({ source: "adaptive", profile: "judgment", tier: 0, requested: SOL_HIGH });
    expect(resolve({ config: sheet, adaptiveAllowed: true, entries: [{ role: "how explorer" }] }).errors).toEqual([
      "entries[0]: adaptive selection requires task",
    ]);
  });

  test.each([
    ["OCX mixed with a fixed pair", { source: "ocx", model: "gpt-6.1-sol", effort: "high", fallback: SOL_HIGH }, 'roles."bug-fix": OCX selection mixes in model, effort'],
    ["OCX without fallback", { source: "ocx" }, 'roles."bug-fix".fallback: expected {model, effort}'],
    ["incomplete fallback", { source: "ocx", fallback: { model: "gpt-6.1-sol" } }, 'roles."bug-fix".fallback: model and effort must both be non-empty strings'],
    ["model without effort", { model: "gpt-6.1-sol" }, 'roles."bug-fix": model and effort must both be non-empty strings'],
    ["adaptive with a pair", { source: "adaptive", model: "gpt-6.1-sol" }, 'roles."bug-fix": adaptive selection mixes in model'],
    ["unknown source", { source: "auto" }, 'roles."bug-fix": unknown source "auto"'],
  ])("rejects %s before dispatch", (_name, selection, message) => {
    const result = resolve({ config: { roles: { "bug-fix": selection } }, entries: [{ role: "judgment" }] }, OCX_ON);
    expect(result).toEqual({ ok: false, errors: [message] });
  });

  test("rejects malformed requests, contracts and tasks", () => {
    expect(resolveBatch({ entries: [{ role: "bug-fix" }] }, { catalog }).errors).toEqual([
      "contract: expected {exactModel: [efforts]} with at least one model",
    ]);
    expect(resolve({ adaptiveAllowed: "yes", entries: [] }).errors).toEqual([
      "adaptiveAllowed: expected a boolean",
      "entries: expected a non-empty array",
    ]);
    expect(resolve({ adaptiveAllowed: true, entries: [{ role: "bug-fix", task: { ...ROUTINE, difficulty: "hard" } }] }).errors).toEqual([
      "entries[0]: task.difficulty: expected one of routine|bounded|complex",
    ]);
  });
});

describe("readOcx", () => {
  const STATUS = { proxy: { running: true }, startup: { routingKind: "opencodex-local" } };
  const AGENT = { injection: { multiAgentGuidanceEnabled: true, model: "gpt-6.1-sol", effort: "high", efforts: ["medium", "high"] } };
  const transport = (responses) => {
    const calls = [];
    const run = (cmd, args, timeoutMs) => {
      calls.push([cmd, ...args, timeoutMs]);
      return responses[args[0]] ?? { status: 127, stdout: "", error: "fixture response absent" };
    };
    return { calls, run };
  };
  const ok = (json) => ({ status: 0, stdout: JSON.stringify(json) });

  test("accepts healthy local routing and calls each command once with a 5s timeout", () => {
    const { calls, run } = transport({ status: ok(STATUS), agent: ok(AGENT) });
    expect(readOcx(run)).toEqual({ ok: true, model: "gpt-6.1-sol", effort: "high" });
    expect(calls).toEqual([
      ["ocx", "status", "--json", 5000],
      ["ocx", "agent", "status", "--json", 5000],
    ]);
  });

  test.each([
    ["a failing command", { status: { status: 1, stdout: JSON.stringify(STATUS) } }, "ocx status --json exited 1"],
    ["a timeout", { status: { status: null, stdout: "", timedOut: true } }, "ocx status --json timed out after 5000ms"],
    ["invalid JSON", { status: { status: 0, stdout: "{" } }, "ocx status --json returned invalid JSON"],
    ["a non-object", { status: { status: 0, stdout: "[]" } }, "ocx status --json did not return a JSON object"],
    ["native routing", { status: ok({ ...STATUS, startup: { routingKind: "native" } }) }, 'OCX routingKind is "native"'],
    ["a stopped proxy", { status: ok({ ...STATUS, proxy: { running: false } }) }, "OCX proxy is not running"],
    ["disabled guidance", { status: ok(STATUS), agent: ok({ injection: { ...AGENT.injection, multiAgentGuidanceEnabled: false } }) }, "OCX injection is missing or multi-agent guidance is disabled"],
    ["an effort outside injection.efforts", { status: ok(STATUS), agent: ok({ injection: { ...AGENT.injection, effort: "max" } }) }, "OCX injection effort max is not in injection.efforts"],
  ])("reports %s as unavailable", (_name, responses, reason) => {
    expect(readOcx(transport(responses).run)).toEqual({ ok: false, reason });
  });
});

describe("escalate", () => {
  const THREAD = "01a106bb-5cf0-7fd3-8aaf-a4bab2d7db19";
  const TRANSCRIPT = "/sessions/rollout-x-" + THREAD + ".jsonl";
  const receipt = resolve({ adaptiveAllowed: true, entries: [{ role: "bug-fix", task: ROUTINE, message: "fix it" }] }).entries[0];
  const evidence = (actual = receipt.requested) => ({
    sessionsRoot: "/sessions", realPath: (path) => path,
    readText: () => JSON.stringify({ type: "session_meta", payload: { id: THREAD } }) + "\n" + JSON.stringify({ type: "turn_context", payload: actual }),
  });
  const safe = { receipt, contract: CONTRACT, verifier: { failed: true, cause: "capability" }, threadId: THREAD, transcript: TRANSCRIPT, sideEffects: "none", previousWorkRecovered: true, freshAttempt: true };
  const run = (input, actual) => escalate(input, { catalog, io: evidence(actual) });

  test("verifies the named native child, moves one tier up, and permits only one escalation", () => {
    const result = run(safe);
    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({ tier: 1, escalation: 1, requested: SOL_HIGH, verifiedAttempt: { threadId: THREAD, actual: receipt.requested }, spawn: { model: "gpt-6.1-sol", reasoning_effort: "high", fork_turns: "none" } });
    expect(run({ ...safe, receipt: result.receipt }, SOL_HIGH).reasons).toEqual(["this selection was already escalated"]);
  });

  test.each([
    ["transport", { verifier: { failed: true, cause: "transport" } }, 'verifier cause is "transport"; only a capability failure escalates'],
    ["timeout", { verifier: { failed: true, cause: "timeout" } }, 'verifier cause is "timeout"; only a capability failure escalates'],
    ["missing context", { verifier: { failed: true, cause: "missing-context" } }, 'verifier cause is "missing-context"; only a capability failure escalates'],
    ["self-reported actual", { actual: SOL_HIGH }, "actual is not accepted; supply the child threadId for native verification"],
    ["uncertain effects", { sideEffects: "uncertain" }, 'side effects are "uncertain"; expected none or reverted'],
    ["unrecovered work", { previousWorkRecovered: false }, "previous work is not recovered"],
    ["reused attempt", { freshAttempt: false }, "escalation needs a fresh attempt"],
    ["changed contract", { contract: { ...CONTRACT, "gpt-6-luna": ["high"] } }, "contract differs from the receipt's contract"],
  ])("refuses %s", (_name, change, reason) => expect(run({ ...safe, ...change })).toEqual({ ok: false, reasons: [reason] }));

  test("does not accept a mismatched native model or missing task classification", () => {
    expect(run(safe, SOL_HIGH).reasons).toContain("native receipt is MISMATCH; actual model/effort must match the requested pair");
    expect(run({ ...safe, receipt: { ...receipt, task: null } }).ok).toBe(false);
    expect(run({ ...safe, receipt: { ...receipt, task: { ...ROUTINE, failureCost: "high" } } }).reasons).toContain("receipt tier does not match its task classification");
  });

  test("refuses fixed and OCX selections, high failure cost, and an exhausted profile", () => {
    const fixed = resolve({ config: SHEET, entries: [{ role: "interrogate reviewers" }] }).entries[0];
    expect(run({ ...safe, receipt: fixed }, fixed.requested).reasons[0]).toBe("source is fixed; only adaptive selections escalate");
    const fallback = resolve({ config: SHEET, entries: [{ role: "bug-fix" }] }).entries[0];
    expect(run({ ...safe, receipt: fallback }, fallback.requested).reasons[0]).toBe("source is fallback; only adaptive selections escalate");
    const risky = resolve({ adaptiveAllowed: true, entries: [{ role: "bug-fix", task: { ...ROUTINE, failureCost: "high" } }] }).entries[0];
    expect(run({ ...safe, receipt: risky }, risky.requested).reasons).toContain("failure cost is high");
    const top = resolve({ adaptiveAllowed: true, entries: [{ role: "bug-fix", task: { difficulty: "complex", failureCost: "medium", reasoningDepth: "deep" } }] }).entries[0];
    expect(run({ ...safe, receipt: top }, top.requested).reasons).toEqual(["already at the top tier of implementation"]);
  });
});

describe("verify", () => {
  const THREAD = "01a106bb-5cf0-7fd3-8aaf-a4bab2d7db19";
  const TRANSCRIPT = "/sessions/rollout-x-" + THREAD + ".jsonl";
  const lines = (...items) => items.map((item) => JSON.stringify(item)).join("\n") + "\n";
  const transcript = lines(
    { type: "session_meta", payload: { id: THREAD } },
    { type: "turn_context", payload: { model: "gpt-6-luna", effort: "medium" } },
    { type: "response_item", payload: {} },
    { type: "turn_context", payload: { model: "gpt-6.1-sol", effort: "high" } },
  );
  const io = (files) => ({
    readText: (path) => {
      if (!(path in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files[path];
    },
    listDir: () => { throw new Error("verify must not list directories for an explicit path"); },
    sessionsRoot: "/sessions",
    realPath: (path) => path,
  });

  test("matches the final turn_context", () => {
    expect(verify({ requested: SOL_HIGH, threadId: THREAD, transcript: TRANSCRIPT }, io({ [TRANSCRIPT]: transcript }))).toEqual({
      status: "MATCH",
      requested: SOL_HIGH,
      actual: SOL_HIGH,
      transcript: TRANSCRIPT,
    });
  });

  test("names each mismatched field", () => {
    expect(verify({ requested: ASTRA_XHIGH, threadId: THREAD, transcript: TRANSCRIPT }, io({ [TRANSCRIPT]: transcript }))).toMatchObject({
      status: "MISMATCH",
      actual: SOL_HIGH,
      differences: ["model", "effort"],
    });
  });

  test("an incomplete later record cannot reuse an earlier matching receipt", () => {
    expect(verify({ requested: SOL_HIGH, threadId: THREAD, transcript: TRANSCRIPT }, io({ [TRANSCRIPT]: transcript + '{"type":"turn_context"' })).status).toBe("INCONCLUSIVE");
    expect(() => verify({ requested: SOL_HIGH, transcript: TRANSCRIPT }, io({ [TRANSCRIPT]: transcript }))).toThrow("child id");
  });

  test("is inconclusive when the transcript is absent, empty, or belongs to another thread", () => {
    expect(verify({ requested: SOL_HIGH, threadId: THREAD, transcript: "/gone.jsonl" }, io({})).status).toBe("INCONCLUSIVE");
    expect(verify({ requested: SOL_HIGH, threadId: THREAD, transcript: TRANSCRIPT }, io({ [TRANSCRIPT]: lines({ type: "session_meta", payload: { id: THREAD } }) })).reason).toBe(
      TRANSCRIPT + " has no final turn_context with model and effort",
    );
    const other = verify({ requested: SOL_HIGH, transcript: TRANSCRIPT, threadId: "01a106bb-5cf0-7fd3-8aaf-000000000000" }, io({ [TRANSCRIPT]: transcript }));
    expect(other.status).toBe("INCONCLUSIVE");
  });

  test("locates a UUIDv7 thread inside its own day directory", () => {
    const sessions = mkdtempSync(join(tmpdir(), "route-sessions-"));
    const created = new Date(parseInt(THREAD.replaceAll("-", "").slice(0, 12), 16));
    const pad = (n) => String(n).padStart(2, "0");
    const dir = join(sessions, String(created.getFullYear()), pad(created.getMonth() + 1), pad(created.getDate()));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "rollout-x-" + THREAD + ".jsonl"), transcript);
    const listed = [];
    const nodeLike = {
      readText: (path) => readFileSync(path, "utf8"),
      listDir: (path) => (listed.push(path), readdirSync(path)),
      sessionsRoot: sessions,
      realPath: realpathSync,
    };
    expect(verify({ requested: SOL_HIGH, threadId: THREAD }, nodeLike).status).toBe("MATCH");
    expect(listed).toEqual([dir]);
    expect(verify({ requested: SOL_HIGH, threadId: "not-a-uuid" }, nodeLike).status).toBe("INCONCLUSIVE");
  });

  test("outside files and replaced session identities cannot provide native proof", () => {
    const fake = io({ "/tmp/fake.jsonl": transcript });
    expect(verify({ requested: SOL_HIGH, threadId: THREAD, transcript: "/tmp/fake.jsonl" }, fake).status).toBe("INCONCLUSIVE");
    const replaced = lines({ type: "session_meta", payload: { id: "other" } }) + transcript;
    expect(verify({ requested: SOL_HIGH, threadId: THREAD, transcript: TRANSCRIPT }, io({ [TRANSCRIPT]: replaced })).status).toBe("INCONCLUSIVE");
    expect(verify({ requested: SOL_HIGH, threadId: THREAD, transcript: TRANSCRIPT }, io({ [TRANSCRIPT]: transcript + lines({ type: "session_meta", payload: { id: "other" } }) })).status).toBe("INCONCLUSIVE");
  });
});

describe("adaptive policy compatibility", () => {
  test("a marker mention or contradictory legacy policy does not enable adaptive", () => {
    const dir = mkdtempSync(join(tmpdir(), "route-policy-"));
    const path = join(dir, "AGENTS.md");
    writeFileSync(path, "Mention " + POLICY_MARKER);
    expect(policyAllowsAdaptive(path)).toBe(false);
    const block = POLICY_MARKER + "\nsource: adaptive\n<!-- /pstack-routing:1 -->\n";
    writeFileSync(path, block);
    expect(policyAllowsAdaptive(path)).toBe(true);
    writeFileSync(path, "All configured defaults, roles and panel slots use `source: ocx`.\n" + block);
    expect(policyAllowsAdaptive(path)).toBe(false);
  });
});

describe("route.mjs CLI", () => {
  const run = (args, input, codexHome) =>
    spawnSync("bun", [script, ...args], {
      input: JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, CODEX_HOME: codexHome },
    });
  const home = () => mkdtempSync(join(tmpdir(), "route-home-"));
  const sheet = (dir, yaml, extra = "") => {
    const path = join(dir, "pstack-models.md");
    writeFileSync(path, "# sheet\n\n" + "\x60\x60\x60yaml\n" + yaml + "\x60\x60\x60\n" + extra);
    return path;
  };
  const FIXED_YAML = 'defaults:\n  judgment: {model: gpt-6-astra, effort: xhigh}\n  evidence: {model: gpt-6-luna, effort: max}\nroles:\n  "bug-fix": {model: gpt-6.1-sol, effort: xhigh}\n';
  const request = { contract: CONTRACT, entries: [{ role: "bug-fix", task: ROUTINE }] };

  test("resolves from the default sheet under CODEX_HOME", () => {
    const dir = home();
    sheet(dir, FIXED_YAML);
    const r = run(["resolve"], request, dir);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).entries[0]).toMatchObject({ source: "fixed", requested: SOL_XHIGH });
  });

  test("--config reads a fixture sheet and must exist", () => {
    const dir = home();
    const path = sheet(mkdtempSync(join(tmpdir(), "route-fixture-")), 'roles:\n  "bug-fix": {model: gpt-6-luna, effort: high}\n');
    const r = run(["resolve", "--config", path], request, dir);
    expect(JSON.parse(r.stdout).entries[0].requested).toEqual(LUNA_HIGH);
    expect(JSON.parse(r.stdout).context).toMatchObject({ explicitPaths: true, sheet: { path, sha256: expect.any(String) } });
    const missing = run(["resolve", "--config", join(dir, "nope.md")], request, dir);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("cannot read sheet");
  });

  test("rejects inline request.config so it cannot shadow the real sheet", () => {
    const r = run(["resolve"], { ...request, config: { roles: {} } }, home());
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("request.config is not accepted by the CLI");
  });

  test("rejects a sheet without exactly one yaml block", () => {
    const dir = home();
    sheet(dir, FIXED_YAML, "\x60\x60\x60yaml\nroles: {}\n\x60\x60\x60\n");
    const r = run(["resolve"], request, dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("expected exactly one fenced yaml block, found 2");
  });

  test("adaptive routing needs the policy marker; a missing default sheet then routes adaptively", () => {
    const dir = home();
    const adaptive = { ...request, adaptiveAllowed: true };
    writeFileSync(join(dir, "AGENTS.md"), "# policy\n");
    const refused = run(["resolve"], adaptive, dir);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(POLICY_MARKER);
    const policy = join(dir, "policy.md");
    writeFileSync(policy, "# policy\n" + POLICY_MARKER + "\nsource: adaptive\n<!-- /pstack-routing:1 -->\n");
    const allowed = run(["resolve", "--policy", policy], adaptive, dir);
    expect(allowed.status).toBe(0);
    expect(JSON.parse(allowed.stdout).entries[0]).toMatchObject({ source: "adaptive", tier: 0, requested: { model: "gpt-6.1-sol", effort: "medium" } });
  });

  test("a missing default sheet without adaptive authorization fails the batch", () => {
    const r = run(["resolve"], request, home());
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).errors).toEqual(["entries[0]: no model sheet exists and adaptive routing is not authorized"]);
  });

  test("verify exits 3 when the transcript is inaccessible", () => {
    const r = run(["verify"], { requested: SOL_HIGH, threadId: "01a106bb-5cf0-7fd3-8aaf-a4bab2d7db19", transcript: join(home(), "missing.jsonl") }, home());
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout).status).toBe("INCONCLUSIVE");
  });
});
