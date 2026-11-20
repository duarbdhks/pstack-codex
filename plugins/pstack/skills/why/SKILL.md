---
name: why
description: "Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Returns a cited read on decisions and tradeoffs. Use how for runtime behavior."
menu-description: investigate why something was built this way (parallel multi-MCP evidence)
---

# Why

Answer from the record, not the code: read the commits and PR discussions that introduced the target and each later change, and other sources if the trail is thin. Cite what the authors wrote, mark your own inferences as inferences, and say what the record does not answer.

## Models

Role defaults, stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`). A matching role line in `~/.codex/pstack-models.md` overrides each at runtime; see `/setup-pstack`.

On Codex, dispatch each role below with the [Codex spawn contract](../poteto-mode/references/codex-tools.md#codex-spawn-contract): `agent_type: "default"`, the role as `task_name`, and the `model` and `reasoning_effort` pair resolved by [Codex routing](../poteto-mode/references/codex-routing.md). An omitted model inherits the parent and is an error.

- why investigators: `gpt-6-luna`
- why synthesizer: `gpt-6-astra`

## Codex runtime

On Codex, upstream tool, path, and agent names in this skill map through [codex-tools.md](../poteto-mode/references/codex-tools.md). A `<role model>` placeholder is the role's model resolved by [Codex routing](../poteto-mode/references/codex-routing.md). Where a step here says to omit `model`, run on the parent model, or fall back to another slug after a rejection, the Codex spawn contract wins: resolve the pair or stop before spawning.
