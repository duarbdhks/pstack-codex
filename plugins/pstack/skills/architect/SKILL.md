---
name: architect
description: "Sketch types, signatures, and module structure before code, then stay in the loop while implementation fills in. Use for /architect, 'architect this', 'design this', or non-trivial work where jumping to code would lock in the wrong shape."
menu-description: settle types and module shape before writing code that crosses a function boundary
---

# Architect

Before writing code, trace every system the change touches, then sketch two different shapes for it (types, signatures, module boundaries) and pick the one where each piece of state has one owner, each task has one way to do it, and callers need to know least. Redesign instead of patching if workarounds repeat.

For a large or contested design, run the **arena** skill instead of sketching alone.

## Models

Role defaults, stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`). A matching role line in `~/.codex/pstack-models.md` overrides each at runtime; see `/setup-pstack`.

On Codex, dispatch each role below with the [Codex spawn contract](../poteto-mode/references/codex-tools.md#codex-spawn-contract): `agent_type: "default"`, the role as `task_name`, and the `model` and `reasoning_effort` pair resolved by [Codex routing](../poteto-mode/references/codex-routing.md). An omitted model inherits the parent and is an error.

- architect runners: `gpt-6-astra`, `gpt-6.1-sol`, `grok-4.7`

## Codex runtime

On Codex, upstream tool, path, and agent names in this skill map through [codex-tools.md](../poteto-mode/references/codex-tools.md). A `<role model>` placeholder is the role's model resolved by [Codex routing](../poteto-mode/references/codex-routing.md). Where a step here says to omit `model`, run on the parent model, or fall back to another slug after a rejection, the Codex spawn contract wins: resolve the pair or stop before spawning.
