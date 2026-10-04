---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and writes a per-role override file. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
menu-description: configure pstack per-role model choices
---

# Setup pstack

Configure per-role model selections for the current runtime. Choose the matching section below.

## Codex

Routing forms and the router are described in [`codex-routing.md`](../poteto-mode/references/codex-routing.md); the global policy block is in [`codex-routing-policy.md`](../poteto-mode/references/codex-routing-policy.md). Prepare concrete diffs for the requested roles and any required policy migration. Apply only the requested changes.

1. Read `~/.codex/AGENTS.md` and the YAML in `~/.codex/pstack-models.md`. Note whether the policy carries the `<!-- pstack-routing:1 -->` marker; without it only fixed and `source: ocx` selections are valid. Validate exact model IDs and effort pairs against the spawn contract listed in this turn, not the catalog alone.
2. Show the current selections and fallback pairs. Preserve `defaults`, role order, grouped role names and every array's purpose, order and panel slots. Resolve OCX once per batch using the global policy; describe fallback availability separately from whether OCX is currently usable.
3. Ask which roles to change and the target form for each: fixed, `source: ocx`, or `source: adaptive` with a `profile` from the generated Dispatch profiles table in `codex-routing.md` (offer the role's default `profile` first). Use `request_user_input` when it is listed; otherwise ask in plain text and stop. Change nothing the user did not pick.
4. For an adaptive choice, preview before writing: run `route.mjs resolve` for that role and profile at the lowest, middle and highest axis values, and show each resolved pair beside the current selection. Use an explicit temporary sheet and a temporary policy containing only the bundled managed block for the preview, not the real global files. Make no cost or pricing claim.
5. If any chosen role is adaptive and the marker is missing, follow the policy file's install rules: show a unified diff that replaces only the selection-forms passage of `~/.codex/AGENTS.md`, and apply it only on explicit request. If that passage cannot be identified or a contradicting rule remains, stop with the diff and the conflicting lines.
6. Apply the chosen changes in the same YAML block. An OCX selection carries a complete `fallback: {model, effort}`; converting a fixed pair to OCX preserves that pair as its fallback. Adaptive selections carry only `source: adaptive` and the chosen `profile`. Preserve the previous selection in the shown diff so it can be restored. Leave every other role exactly as it was: never migrate existing fixed or OCX selections in bulk. A changed OCX model belongs in OpenCodex, not a hard-coded copy here; changing OpenCodex requires the user's request.
7. Validate both fields of every fallback against the listed spawn contract. If creating a missing sheet, include `defaults.judgment` and `defaults.evidence`, take role names and panel counts from the generated role list below, and confirm supported fallback pairs. Do not copy catalog aliases, guess effort or inherit the parent model. Reject incomplete or mixed selections.
8. Save only the approved role settings in `~/.codex/pstack-models.md`. Keep policy text in `~/.codex/AGENTS.md`; do not paste the YAML there. Report the changed selections, how each resolves, and any policy diff that was applied or left pending.

Do not apply the Claude Code template below on Codex. Model and effort are always explicit; `inherit-parent` and `auto` are not Codex selections.

## Claude Code

Legacy runtime; see [`legacy-tools.md`](../poteto-mode/references/legacy-tools.md).

Write `~/.claude/pstack-models.md` and include it from `CLAUDE.md`. Pick reachable slugs from the sidecar catalog in Models. Each skill's defaults apply only when the override sheet has no matching role.

Claude Code has no auto-applied "rules" mechanism like Cursor's `.mdc`. Inclusion is explicit: the user adds a line to `~/.claude/CLAUDE.md` (or their project `CLAUDE.md`) such as:

```text
@~/.claude/pstack-models.md
```

so the file is loaded as context for every session.

### Steps

### 1. Detect available models

Enumerate the model slugs you can pass to an `Agent` subagent in this session. Offer the sidecar catalog in [Models](#models) and ask the user to confirm additional slugs. Never write a real slug without confirming availability. On Claude Code, `inherit-parent` and `auto` mean omitting `model` in the `Agent` call.

### 2. Load current state

The default role-to-model mapping is shown in step 5 below. If `~/.claude/pstack-models.md` exists, read it as the current choices. Otherwise start from those defaults.

### 3. Map and confirm

Show every role with its current model, marking any real slug without direct or external availability as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` as the options. Prefer `AskUserQuestion` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. Arena selects one model from `arena cross-judge pool`, whose default is Astra. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real slug written must be in the detected set; `inherit-parent` and `auto` always pass on Claude Code. If a chosen model is unavailable, ask for a supported choice.

### 5. Write the override sheet

Write `~/.claude/pstack-models.md` with the shape below. Overwrite the whole file so re-runs stay idempotent.

```markdown
# pstack model configuration

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out.

feature, refactoring: gpt-6.1-sol
bug-fix: gpt-6.1-sol
perf-issue: gpt-6.1-sol
hillclimb: gpt-6.1-sol
judgment and prose: gpt-6-astra
strongest judgment: gpt-6-astra
how explorer: gpt-6-luna
how explainer: gpt-6-astra
why investigators: gpt-6-luna
why synthesizer: gpt-6-astra
reflect tooling: gpt-6-luna
reflect judgment, divergent, synthesizer: gpt-6-astra
arena runners: gpt-6.1-sol, grok-4.7
arena cross-judge pool: gpt-6-astra
swarm workers: gpt-6-luna
architect runners: gpt-6-astra, gpt-6.1-sol, grok-4.7
interrogate reviewers: gpt-6.1-sol, grok-4.7
```

### 6. Wire it in

If `~/.claude/CLAUDE.md` does not already include `~/.claude/pstack-models.md`, append the `@~/.claude/pstack-models.md` line. If the user prefers project scope, add the include to the project's `CLAUDE.md` instead.

### 7. Confirm

Tell the user where the override was written and which `CLAUDE.md` includes it. Re-running this skill updates the override sheet.

## Models

Stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`).

- Available models: GPT-6 Astra (`gpt-6-astra`), GPT-6.1 Sol (`gpt-6.1-sol`), Claude Opus 5.5 (`anthropic/claude-opus-5-5`), GPT-6 Luna (`gpt-6-luna`), Grok 4.7 (`grok-4.7`), Grok 4.6 (`grok-4.6`), DeepSeek Flash (`deepseek-flash`), GPT-5.5 (`gpt-5.5`), GPT-5.4 (`gpt-5.4`)
- Default panel: `gpt-6-astra`, `gpt-6.1-sol`, `grok-4.7`
- Single-role default: `gpt-6-astra`
