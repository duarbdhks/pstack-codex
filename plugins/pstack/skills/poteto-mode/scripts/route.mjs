#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const GENERATED_CATALOG_PATH = join(SCRIPT_DIR, "models.generated.json");
export const SOURCE_CATALOG_PATH = join(SCRIPT_DIR, "../../../models.json");
export const POLICY_MARKER = "<!-- pstack-routing:1 -->";
export const OCX_TIMEOUT_MS = 5000;

export const TASK_LEVELS = {
  difficulty: ["routine", "bounded", "complex"],
  failureCost: ["low", "medium", "high"],
  reasoningDepth: ["shallow", "standard", "deep"],
};
const DEFAULT_KEYS = ["evidence", "judgment", "implementation"];
const SIDE_EFFECTS_OK = ["none", "reverted"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string" && v.trim() !== "";
const extraKeys = (value, allowed) => Object.keys(value).filter((k) => !allowed.includes(k));
const samePair = (a, b) => isObject(a) && isObject(b) && a.model === b.model && a.effort === b.effort;
const pairText = ({ model, effort }) => model + "/" + effort;

function parsePair(value, where) {
  if (!isObject(value)) throw new Error(where + ": expected {model, effort}");
  const extra = extraKeys(value, ["model", "effort"]);
  if (extra.length) throw new Error(where + ": unexpected keys " + extra.join(", "));
  if (!isText(value.model) || !isText(value.effort)) throw new Error(where + ": model and effort must both be non-empty strings");
  return { model: value.model, effort: value.effort };
}

export function defaultCatalogPath(exists = existsSync) {
  return exists(GENERATED_CATALOG_PATH) ? GENERATED_CATALOG_PATH : SOURCE_CATALOG_PATH;
}

export function routingFromCatalog(catalog) {
  const routing = catalog?.codexRouting;
  if (!isObject(routing) || routing.version !== 1) throw new Error("models.json: codexRouting.version must be 1");
  const known = new Set(catalog.available.map((entry) => entry.slug));
  for (const [name, ladder] of Object.entries(routing.profiles ?? {})) {
    if (!Array.isArray(ladder) || ladder.length !== 3) throw new Error("models.json: profile " + name + " needs 3 tiers");
    ladder.forEach((step, i) => {
      const pair = parsePair(step, "models.json: profiles." + name + "[" + i + "]");
      if (!known.has(pair.model)) throw new Error("models.json: profiles." + name + " uses an uncatalogued model " + pair.model);
    });
  }
  const roles = new Map();
  for (const role of catalog.roles ?? []) {
    if (role.profile !== undefined && !routing.profiles[role.profile]) {
      throw new Error("models.json: role " + role.role + " names unknown profile " + role.profile);
    }
    roles.set(role.role, role);
  }
  return { profiles: routing.profiles, roles };
}

export function adaptiveTier(task) {
  return Math.max(...Object.entries(TASK_LEVELS).map(([key, levels]) => levels.indexOf(task[key])));
}

function parseTask(task, where) {
  if (!isObject(task)) throw new Error(where + ": expected {difficulty, failureCost, reasoningDepth}");
  const extra = extraKeys(task, Object.keys(TASK_LEVELS));
  if (extra.length) throw new Error(where + ": unexpected keys " + extra.join(", "));
  for (const [key, levels] of Object.entries(TASK_LEVELS)) {
    if (!levels.includes(task[key])) throw new Error(where + "." + key + ": expected one of " + levels.join("|"));
  }
  return { difficulty: task.difficulty, failureCost: task.failureCost, reasoningDepth: task.reasoningDepth };
}

function parseSelection(value, where, routing) {
  if (!isObject(value)) throw new Error(where + ": expected a selection object");
  if (!("source" in value)) return { kind: "fixed", ...parsePair(value, where) };
  if (value.source === "ocx") {
    const extra = extraKeys(value, ["source", "fallback"]);
    if (extra.length) throw new Error(where + ": OCX selection mixes in " + extra.join(", "));
    return { kind: "ocx", fallback: parsePair(value.fallback, where + ".fallback") };
  }
  if (value.source === "adaptive") {
    const extra = extraKeys(value, ["source", "profile"]);
    if (extra.length) throw new Error(where + ": adaptive selection mixes in " + extra.join(", "));
    if (!isText(value.profile) || !routing.profiles[value.profile]) throw new Error(where + ": unknown profile " + value.profile);
    return { kind: "adaptive", profile: value.profile };
  }
  throw new Error(where + ": unknown source " + JSON.stringify(value.source));
}

function parseConfig(config, routing, errors) {
  if (config === null || config === undefined) return null;
  if (!isObject(config)) {
    errors.push("config: expected an object");
    return null;
  }
  const extra = extraKeys(config, ["defaults", "roles"]);
  if (extra.length) errors.push("config: unexpected keys " + extra.join(", "));
  const parsed = { defaults: {}, roles: new Map() };
  const section = (name) => {
    const value = config[name] ?? {};
    if (!isObject(value)) errors.push("config." + name + ": expected a mapping");
    return isObject(value) ? Object.entries(value) : [];
  };
  for (const [key, value] of section("defaults")) {
    if (!DEFAULT_KEYS.includes(key)) {
      errors.push("defaults." + key + ": expected one of " + DEFAULT_KEYS.join("|"));
      continue;
    }
    try { parsed.defaults[key] = parseSelection(value, "defaults." + key, routing); } catch (e) { errors.push(e.message); }
  }
  for (const [role, value] of section("roles")) {
    const where = "roles." + JSON.stringify(role);
    const slots = Array.isArray(value) ? value : [value];
    if (slots.length === 0) {
      errors.push(where + ": empty panel");
      continue;
    }
    try {
      parsed.roles.set(role, slots.map((slot, i) => parseSelection(slot, Array.isArray(value) ? where + "[" + i + "]" : where, routing)));
    } catch (e) { errors.push(e.message); }
  }
  return parsed;
}

function parseContract(contract, errors) {
  if (!isObject(contract) || Object.keys(contract).length === 0) {
    errors.push("contract: expected {exactModel: [efforts]} with at least one model");
    return null;
  }
  for (const [model, efforts] of Object.entries(contract)) {
    if (!isText(model) || !Array.isArray(efforts) || efforts.length === 0 || !efforts.every(isText)) {
      errors.push("contract." + model + ": expected a non-empty array of efforts");
    }
  }
  return contract;
}

export function contractDigest(contract) {
  const canonical = Object.keys(contract).sort().map((model) => [model, [...new Set(contract[model])].sort()]);
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

const supports = (contract, pair) => Array.isArray(contract[pair.model]) && contract[pair.model].includes(pair.effort);

function requireSupported(contract, pair, what) {
  if (!supports(contract, pair)) throw new Error(what + " " + pairText(pair) + " is not supported by the request contract");
}

function lookupRole(role, ctx) {
  const catalogRole = ctx.routing.roles.get(role);
  const profile = catalogRole?.profile ?? (DEFAULT_KEYS.includes(role) ? role : null);
  const configured = ctx.config?.roles.get(role);
  const slotCount = configured?.length ?? catalogRole?.models.length ?? 1;
  if (ctx.config === null) return { profile, slotCount, selections: Array(slotCount).fill({ kind: "adaptive", profile }) };
  if (configured) return { profile, slotCount, selections: configured };
  if (!profile) throw new Error("role " + JSON.stringify(role) + " is in neither the sheet nor the catalog");
  const selection = ctx.config.defaults[profile] ?? (profile === "implementation" ? ctx.config.defaults.judgment : undefined);
  if (!selection) throw new Error("role " + JSON.stringify(role) + " is unlisted and defaults." + profile + " is missing");
  return { profile, slotCount, selections: Array(slotCount).fill(selection) };
}

function pick(selection, profile, task, ctx) {
  if (selection.kind === "fixed") {
    requireSupported(ctx.contract, selection, "fixed selection");
    return { source: "fixed", requested: { model: selection.model, effort: selection.effort } };
  }
  if (selection.kind === "ocx") {
    requireSupported(ctx.contract, selection.fallback, "OCX fallback");
    const state = ctx.readOcxOnce();
    if (state.ok && supports(ctx.contract, state)) return { source: "ocx", requested: { model: state.model, effort: state.effort } };
    const reason = state.ok ? "OCX injection " + pairText(state) + " is not supported by the request contract" : state.reason;
    return { source: "fallback", requested: { ...selection.fallback }, reason };
  }
  if (!ctx.adaptiveAllowed) throw new Error("adaptive selection requires adaptiveAllowed");
  const chosen = selection.profile ?? profile;
  if (!chosen) throw new Error("adaptive selection has no profile; name one in the sheet or use a catalog role");
  if (!task) throw new Error("adaptive selection requires task");
  const tier = adaptiveTier(task);
  const requested = { ...ctx.routing.profiles[chosen][tier] };
  requireSupported(ctx.contract, requested, "adaptive " + chosen + " tier " + tier);
  return { source: "adaptive", profile: chosen, tier, requested };
}

function resolveEntry(entry, index, ctx) {
  if (!isObject(entry)) throw new Error("expected an object");
  const extra = extraKeys(entry, ["role", "task", "message", "user", "choice"]);
  if (extra.length) throw new Error("unexpected keys " + extra.join(", "));
  if (!isText(entry.role)) throw new Error("role: expected a non-empty string");
  if (entry.message !== undefined && !isText(entry.message)) throw new Error("message: expected a non-empty string");
  const task = entry.task === undefined ? null : parseTask(entry.task, "task");
  const user = entry.user === undefined ? null : parsePair(entry.user, "user");

  let looked;
  if (user) {
    requireSupported(ctx.contract, user, "user selection");
    const catalogRole = ctx.routing.roles.get(entry.role);
    const slotCount = ctx.config?.roles.get(entry.role)?.length ?? catalogRole?.models.length ?? 1;
    looked = { profile: catalogRole?.profile ?? null, slotCount, selections: null };
  } else {
    looked = lookupRole(entry.role, ctx);
    if (ctx.config === null && !ctx.adaptiveAllowed) throw new Error("no model sheet exists and adaptive routing is not authorized");
  }

  const pool = ctx.routing.roles.get(entry.role)?.kind === "pool";
  if (pool && looked.slotCount > 1 && entry.choice === undefined) throw new Error("choose one pool entry with choice; a candidate pool is not a fan-out instruction");
  if (entry.choice !== undefined && (!pool || !Number.isInteger(entry.choice) || entry.choice < 0 || entry.choice >= looked.slotCount)) throw new Error("choice must name one valid candidate pool slot");
  const slots = pool ? [entry.choice ?? 0] : Array.from({ length: looked.slotCount }, (_, slot) => slot);
  return slots.map((slot) => {
    const chosen = user
      ? { source: "user", requested: { ...user } }
      : pick(looked.selections[slot], looked.profile, task, ctx);
    return {
      index,
      role: entry.role,
      slot,
      slots: looked.slotCount,
      ...(pool && { pool: true }),
      profile: chosen.profile ?? looked.profile ?? null,
      source: chosen.source,
      tier: chosen.tier ?? null,
      escalation: 0,
      requested: chosen.requested,
      ...(chosen.reason && { reason: chosen.reason }),
      task,
      contractDigest: ctx.digest,
      spawn: spawnPayload(entry.role, chosen.requested, entry.message),
    };
  });
}

function spawnPayload(role, pair, message) {
  return {
    agent_type: "default",
    task_name: role,
    model: pair.model,
    reasoning_effort: pair.effort,
    fork_turns: "none",
    ...(message !== undefined && { message }),
  };
}

export function resolveBatch(request, { catalog, ocx = () => ({ ok: false, reason: "OCX status was not read" }) }) {
  const errors = [];
  let routing;
  try { routing = routingFromCatalog(catalog); } catch (e) { return { ok: false, errors: [e.message] }; }
  if (!isObject(request)) return { ok: false, errors: ["request: expected an object"] };
  const extra = extraKeys(request, ["entries", "contract", "config", "adaptiveAllowed"]);
  if (extra.length) errors.push("request: unexpected keys " + extra.join(", "));
  if (request.adaptiveAllowed !== undefined && typeof request.adaptiveAllowed !== "boolean") errors.push("adaptiveAllowed: expected a boolean");
  if (!Array.isArray(request.entries) || request.entries.length === 0) errors.push("entries: expected a non-empty array");
  const contract = parseContract(request.contract, errors);
  const config = parseConfig(request.config, routing, errors);
  if (errors.length) return { ok: false, errors };

  let ocxState;
  const ctx = {
    routing,
    contract,
    config,
    adaptiveAllowed: request.adaptiveAllowed === true,
    digest: contractDigest(contract),
    readOcxOnce: () => (ocxState ??= ocx()),
  };
  const entries = [];
  request.entries.forEach((entry, index) => {
    try { entries.push(...resolveEntry(entry, index, ctx)); } catch (e) { errors.push("entries[" + index + "]: " + e.message); }
  });
  return errors.length ? { ok: false, errors } : { ok: true, contractDigest: ctx.digest, entries };
}

export function runCommand(cmd, args, timeoutMs) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs });
  const timedOut = r.error?.code === "ETIMEDOUT" || (r.status === null && r.signal != null);
  return { status: r.status, stdout: r.stdout ?? "", timedOut, error: timedOut ? undefined : r.error?.message };
}

export function readOcx(run = runCommand) {
  const read = (args) => {
    const label = "ocx " + args.join(" ");
    const r = run("ocx", args, OCX_TIMEOUT_MS);
    if (r.timedOut) return { error: label + " timed out after " + OCX_TIMEOUT_MS + "ms" };
    if (r.error) return { error: label + " failed: " + r.error };
    if (r.status !== 0) return { error: label + " exited " + r.status };
    try {
      const json = JSON.parse(r.stdout);
      return isObject(json) ? { json } : { error: label + " did not return a JSON object" };
    } catch {
      return { error: label + " returned invalid JSON" };
    }
  };
  const status = read(["status", "--json"]);
  const agent = read(["agent", "status", "--json"]);
  if (status.error) return { ok: false, reason: status.error };
  if (status.json.proxy?.running !== true) return { ok: false, reason: "OCX proxy is not running" };
  const routingKind = status.json.startup?.routingKind;
  if (routingKind !== "opencodex-local") return { ok: false, reason: "OCX routingKind is " + JSON.stringify(routingKind ?? null) };
  if (agent.error) return { ok: false, reason: agent.error };
  const injection = agent.json.injection;
  if (!isObject(injection) || injection.multiAgentGuidanceEnabled !== true) return { ok: false, reason: "OCX injection is missing or multi-agent guidance is disabled" };
  if (!isText(injection.model) || !isText(injection.effort)) return { ok: false, reason: "OCX injection has no model/effort" };
  if (!Array.isArray(injection.efforts) || !injection.efforts.includes(injection.effort)) {
    return { ok: false, reason: "OCX injection effort " + injection.effort + " is not in injection.efforts" };
  }
  return { ok: true, model: injection.model, effort: injection.effort };
}

export function escalate(input, { catalog, io }) {
  const routing = routingFromCatalog(catalog);
  if (!isObject(input) || !isObject(input.receipt)) return { ok: false, reasons: ["receipt is required"] };
  const { receipt, contract, verifier, threadId, transcript, sideEffects, previousWorkRecovered, freshAttempt, message } = input;
  if (receipt.source !== "adaptive") return { ok: false, reasons: ["source is " + receipt.source + "; only adaptive selections escalate"] };
  if (receipt.escalation !== 0) return { ok: false, reasons: ["this selection was already escalated"] };
  const reasons = [];
  if ("actual" in input) reasons.push("actual is not accepted; supply the child threadId for native verification");
  let task;
  try { task = parseTask(receipt.task, "receipt.task"); } catch (error) { reasons.push(error.message); }
  if (task && receipt.escalation === 0 && adaptiveTier(task) !== receipt.tier) reasons.push("receipt tier does not match its task classification");
  const ladder = routing.profiles[receipt.profile];
  let next = null;
  if (!ladder) reasons.push("unknown profile " + receipt.profile);
  else if (!Number.isInteger(receipt.tier) || !samePair(ladder[receipt.tier], receipt.requested)) reasons.push("receipt tier does not match its profile ladder");
  else if (receipt.tier >= ladder.length - 1) reasons.push("already at the top tier of " + receipt.profile);
  else next = { ...ladder[receipt.tier + 1] };
  if (verifier?.failed !== true || verifier?.cause !== "capability") {
    reasons.push("verifier cause is " + JSON.stringify(verifier?.cause ?? null) + "; only a capability failure escalates");
  }
  let verification;
  try { verification = verify({ requested: receipt.requested, threadId, transcript }, io); }
  catch (error) { verification = { status: "INCONCLUSIVE", reason: error.message }; }
  if (verification.status !== "MATCH") reasons.push("native receipt is " + verification.status + "; actual model/effort must match the requested pair");
  if (!SIDE_EFFECTS_OK.includes(sideEffects)) reasons.push("side effects are " + JSON.stringify(sideEffects ?? null) + "; expected none or reverted");
  if (receipt.task?.failureCost === "high") reasons.push("failure cost is high");
  if (previousWorkRecovered !== true) reasons.push("previous work is not recovered");
  if (freshAttempt !== true) reasons.push("escalation needs a fresh attempt");
  const contractErrors = [];
  parseContract(contract, contractErrors);
  if (contractErrors.length || contractDigest(contract) !== receipt.contractDigest) reasons.push("contract differs from the receipt's contract");
  else if (next && !supports(contract, next)) reasons.push("next tier " + pairText(next) + " is not supported by the request contract");
  if (message !== undefined && !isText(message)) reasons.push("message must be a non-empty string");
  if (reasons.length) return { ok: false, reasons };
  return {
    ok: true,
    receipt: {
      ...receipt,
      tier: receipt.tier + 1,
      escalation: 1,
      escalatedFrom: receipt.requested,
      verifiedAttempt: { threadId, actual: verification.actual, transcript: verification.transcript },
      requested: next,
      spawn: spawnPayload(receipt.role, next, message ?? receipt.spawn?.message),
    },
  };
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A UUIDv7 thread id carries its creation time, so only the matching local
// day directory and its neighbours are listed.
export function locateTranscript(threadId, { sessionsRoot, listDir }) {
  if (!UUID_V7.test(threadId)) return null;
  const ms = parseInt(threadId.replaceAll("-", "").slice(0, 12), 16);
  const pad = (n) => String(n).padStart(2, "0");
  for (const offset of [0, -1, 1]) {
    const day = new Date(ms + offset * 86_400_000);
    const dir = join(sessionsRoot, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()));
    let names;
    try { names = listDir(dir); } catch { continue; }
    const name = names.find((n) => n.startsWith("rollout-") && n.endsWith("-" + threadId + ".jsonl"));
    if (name) return join(dir, name);
  }
  return null;
}

function codexHome() {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

const nodeIo = () => ({
  readText: (path) => readFileSync(path, "utf8"),
  listDir: (dir) => readdirSync(dir),
  sessionsRoot: join(codexHome(), "sessions"),
  realPath: realpathSync,
});

export function verify(input, io = nodeIo()) {
  if (!isObject(input)) throw new Error("verify: expected an object");
  const requested = parsePair(input.requested, "requested");
  const threadId = input.threadId;
  if (!isText(threadId)) throw new Error("threadId: expected the child id from the spawn result");
  if (input.transcript !== undefined && !isText(input.transcript)) throw new Error("transcript: expected a path");
  const inconclusive = (reason) => ({ status: "INCONCLUSIVE", requested, reason });
  const path = input.transcript || locateTranscript(threadId, io);
  if (!path) return inconclusive("no transcript found for thread " + threadId + "; pass its path");
  try {
    const root = io.realPath(io.sessionsRoot);
    const actualPath = io.realPath(path);
    const rel = relative(root, actualPath);
    if (rel.startsWith("..") || isAbsolute(rel) || !basename(actualPath).startsWith("rollout-") || !basename(actualPath).endsWith("-" + threadId + ".jsonl")) {
      return inconclusive("transcript must be the named child file inside the Codex sessions root");
    }
  } catch { return inconclusive("native transcript or sessions root is inaccessible"); }
  let text;
  try { text = io.readText(path); } catch (e) { return inconclusive("cannot read " + path + ": " + (e.code ?? e.message)); }
  let sessionId = null;
  let last = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let item;
    try { item = JSON.parse(line); } catch { return inconclusive(path + " has an incomplete or invalid JSONL record"); }
    if (item?.type === "session_meta") {
      const identity = item.payload?.id ?? null;
      if (sessionId !== null && identity !== sessionId) return inconclusive(path + " has conflicting session identities");
      if (sessionId === null) sessionId = identity;
    }
    if (item?.type === "turn_context") last = item.payload;
  }
  if (sessionId !== threadId) return inconclusive(path + " belongs to thread " + sessionId + ", not " + threadId);
  if (!isText(last?.model) || !isText(last?.effort)) return inconclusive(path + " has no final turn_context with model and effort");
  const actual = { model: last.model, effort: last.effort };
  const differences = ["model", "effort"].filter((key) => actual[key] !== requested[key]);
  return differences.length
    ? { status: "MISMATCH", requested, actual, differences, transcript: path }
    : { status: "MATCH", requested, actual, transcript: path };
}

export function parseSheet(text, path) {
  const blocks = [...text.matchAll(/^\x60{3}yaml[ \t]*\n([\s\S]*?)^\x60{3}[ \t]*$/gm)];
  if (blocks.length !== 1) throw new Error(path + ": expected exactly one fenced yaml block, found " + blocks.length);
  return Bun.YAML.parse(blocks[0][1]);
}

export function loadSheet(explicitPath, defaultPath) {
  const path = explicitPath ?? defaultPath;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (!explicitPath && e.code === "ENOENT") return null;
    throw new Error("cannot read sheet " + path + ": " + (e.code ?? e.message));
  }
  return parseSheet(text, path);
}

export function policyAllowsAdaptive(path) {
  try {
    const text = readFileSync(path, "utf8");
    const start = text.indexOf(POLICY_MARKER);
    const end = text.indexOf("<!-- /pstack-routing:1 -->", start);
    if (start < 0 || end < 0 || !text.slice(start, end).includes("source: adaptive")) return false;
    const outside = text.slice(0, start) + text.slice(end + "<!-- /pstack-routing:1 -->".length);
    return !/All\s+configured\s+defaults,\s+roles\s+and\s+panel\s+slots\s+use\s+[`]?source:\s*ocx/.test(outside);
  } catch { return false; }
}

const USAGE = "usage: route.mjs resolve [--config PATH] [--policy PATH] | escalate | verify  (JSON on stdin)";

function parseFlags(args, allowed) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, "");
    if (!args[i]?.startsWith("--") || !allowed.includes(name) || !isText(args[i + 1]) || name in flags) throw new Error(USAGE);
    flags[name] = args[i + 1];
  }
  return flags;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "help") return { output: { usage: USAGE, input: "JSON on stdin; resolve needs entries and the current tool contract", receipt: "verify needs requested pair and threadId; transcript is optional" }, code: 0 };
  if (!["resolve", "escalate", "verify"].includes(command)) throw new Error(USAGE);
  const flags = parseFlags(rest, command === "resolve" ? ["config", "policy"] : []);
  const input = JSON.parse(await Bun.stdin.text());
  const catalog = JSON.parse(readFileSync(defaultCatalogPath(), "utf8"));
  if (command === "resolve") {
    if (!isObject(input)) throw new Error("request: expected an object");
    if ("config" in input) throw new Error("request.config is not accepted by the CLI; the sheet comes from --config or " + join(codexHome(), "pstack-models.md"));
    const policy = flags.policy ?? join(codexHome(), "AGENTS.md");
    if (input.adaptiveAllowed === true && !policyAllowsAdaptive(policy)) {
      throw new Error("adaptiveAllowed needs " + POLICY_MARKER + " in " + policy);
    }
    const config = loadSheet(flags.config, join(codexHome(), "pstack-models.md"));
    const result = resolveBatch({ ...input, config }, { catalog, ocx: () => readOcx() });
    const fileEvidence = (path) => {
      try { return { path: resolve(path), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }; }
      catch { return { path: resolve(path), sha256: null }; }
    };
    result.context = { sheet: fileEvidence(flags.config ?? join(codexHome(), "pstack-models.md")), policy: fileEvidence(policy), explicitPaths: Boolean(flags.config || flags.policy) };
    return { output: result, code: result.ok ? 0 : 1 };
  }
  if (command === "escalate") {
    const result = escalate(input, { catalog });
    return { output: result, code: result.ok ? 0 : 1 };
  }
  const result = verify(input);
  return { output: result, code: { MATCH: 0, MISMATCH: 1, INCONCLUSIVE: 3 }[result.status] };
}

if (import.meta.main) {
  try {
    const { output, code } = await main(process.argv.slice(2));
    console.log(JSON.stringify(output, null, 2));
    process.exit(code);
  } catch (err) {
    console.error("route: " + err.message);
    process.exit(2);
  }
}
