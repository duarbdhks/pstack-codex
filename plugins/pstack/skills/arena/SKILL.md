---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
menu-description: run N parallel attempts at the same task and pick the best parts
---

# Arena

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Resolve `arena runners` through [Codex routing](../poteto-mode/references/codex-routing.md) and use the returned `spawn` payloads in order. Configure more slots to compare more design directions. Repeat a model when the work needs more candidates.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Spawn all N subagents in one message with `run_in_background: true`, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one read-only judge. Resolve `arena cross-judge pool` in order through [Codex routing](../poteto-mode/references/codex-routing.md). For a pool with multiple entries, pass the candidate's zero-based index as `choice`. Use the first supported resolved model whose provider differs from the parent's provider. Fable and Opus both count as Anthropic. If the parent's model is unknown, use the first supported entry and say you could not check the provider. If no candidate qualifies, say so and continue to Phase D. While you read in Phase D, the judge scores each candidate, by path label, on each rubric criterion and recommends a base.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.

## Models

Role defaults, stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`). A matching role line in `~/.codex/pstack-models.md` overrides each at runtime; see `/setup-pstack`.

On Codex, dispatch each role below with the [Codex spawn contract](../poteto-mode/references/codex-tools.md#codex-spawn-contract): `agent_type: "default"`, the role as `task_name`, and the `model` and `reasoning_effort` pair resolved by [Codex routing](../poteto-mode/references/codex-routing.md). An omitted model inherits the parent and is an error.

- arena runners: `gpt-6.1-sol`, `grok-4.7`
- arena cross-judge pool: `gpt-6-astra`

## Codex runtime

On Codex, upstream tool, path, and agent names in this skill map through [codex-tools.md](../poteto-mode/references/codex-tools.md). A `<role model>` placeholder is the role's model resolved by [Codex routing](../poteto-mode/references/codex-routing.md). Where a step here says to omit `model`, run on the parent model, or fall back to another slug after a rejection, the Codex spawn contract wins: resolve the pair or stop before spawning.
