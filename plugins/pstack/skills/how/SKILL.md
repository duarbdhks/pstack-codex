---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
menu-description: walk through how a subsystem works
---

# How

Explore the codebase to answer "how does X work?" questions.

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

## 1. Explain

Spawn one Task subagent with `subagent_type: generalPurpose` and `readonly: true` that explores and explains in one pass. Give it the user's question and this brief:

> You are writing an architectural explanation for a senior engineer. Explore the codebase and write an explanation that a senior engineer unfamiliar with this area could read and walk away with a solid mental model. They should understand the architecture well enough to start working in it confidently. You have read-only access to the codebase.

## 2. Present

Present the subagent's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Models

Role defaults, stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`). A matching role line in `~/.codex/pstack-models.md` overrides each at runtime; see `/setup-pstack`.

On Codex, dispatch each role below with the [Codex spawn contract](../poteto-mode/references/codex-tools.md#codex-spawn-contract): `agent_type: "default"`, the role as `task_name`, and the `model` and `reasoning_effort` pair resolved by [Codex routing](../poteto-mode/references/codex-routing.md). An omitted model inherits the parent and is an error.

- how explorer: `gpt-6-luna`
- how explainer: `gpt-6-astra`

## Codex runtime

On Codex, upstream tool, path, and agent names in this skill map through [codex-tools.md](../poteto-mode/references/codex-tools.md). A `<role model>` placeholder is the role's model resolved by [Codex routing](../poteto-mode/references/codex-routing.md). Where a step here says to omit `model`, run on the parent model, or fall back to another slug after a rejection, the Codex spawn contract wins: resolve the pair or stop before spawning.
