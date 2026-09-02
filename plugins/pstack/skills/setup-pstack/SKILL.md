---
name: setup-pstack
description: Configure which models pstack uses per role. Detects your available models and writes a per-role override file. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
menu-description: configure pstack per-role model choices
---

# Setup pstack

Write a per-role model override sheet. On Claude Code that is `~/.claude/pstack-models.md`, included from `CLAUDE.md`. On Codex that is `~/.codex/pstack-models.md`, pasted into `~/.codex/AGENTS.md`. Each pstack skill names a default model inline; the override sheet is the layer that adapts those defaults to the models you actually have access to.

**Platform note.** Defaults are the Codex+Grok catalog stamped into the Models section. The override sheet is `~/.codex/pstack-models.md` on Codex (paste into `~/.codex/AGENTS.md`; Codex has no `@`-include) and `~/.claude/pstack-models.md` on Claude Code (include from `CLAUDE.md`). Role rows in step 5 are identical across runtimes; only the slugs, the file path, and the load mechanism change. On Claude Code, pick slugs from the sidecar catalog in Models. Detect reachable slugs from the current session, never write a slug you have not confirmed. See [`codex-tools.md`](../poteto-mode/references/codex-tools.md).

Claude Code has no auto-applied "rules" mechanism like Cursor's `.mdc`. Inclusion is explicit: the user adds a line to `~/.claude/CLAUDE.md` (or their project `CLAUDE.md`) such as:

```text
@~/.claude/pstack-models.md
```

so the file is loaded as context for every session.

## Steps

### 1. Detect available models

Enumerate the model slugs you can pass to an `Agent` subagent in this session — that is the dependable source. The currently available models and the default panel are listed in [Models](#models) below; the panel is chosen for cross-family diversity, and the single-role default stays out of the panels because it already covers the single-model roles. On Claude Code, offer the sidecar catalog from that same section. Ask the user to confirm or paste any additional slugs they want available. Never write a real slug you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected slugs; both mean the role runs on the parent session's model, which the `Agent` call expresses by omitting `model`.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in step 5 below. If the runtime's override sheet already exists (`~/.claude/pstack-models.md` or `~/.codex/pstack-models.md`), read it and treat its values as the current choices. Otherwise start from those defaults.

### 3. Map and confirm

Show every role with its current model, marking any real slug not in the detected set as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` as the options. Prefer `AskUserQuestion` over free text. For panel roles (how critics, arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real slug written must be in the detected set; `inherit-parent` and `auto` always pass. If a chosen real slug is not available, stop and ask again. An override pointing at a model the user cannot use breaks every delegation that reads it.

### 5. Write the override sheet

Write the override sheet (`~/.claude/pstack-models.md` on Claude Code, `~/.codex/pstack-models.md` on Codex) with the shape below. Overwrite the whole file so re-runs stay idempotent.

```markdown
# pstack model configuration

Per-role model overrides for pstack skills. Each pstack SKILL.md names its defaults in a Models section; the values here override those defaults. Delete a line to fall back to the skill default. A value of `inherit-parent` or `auto` runs that role on the parent session's model (the `Agent` call omits `model`); an alias entry in a panel list still counts toward that panel's fan-out.

feature, refactoring: gpt-5.6-sol
bug-fix: gpt-5.6-sol
perf-issue: gpt-5.6-sol
hillclimb: gpt-5.6-sol
judgment and prose: gpt-5.6-sol
strongest judgment: gpt-5.6-sol
how explorer: gpt-5.6-luna
how explainer: gpt-5.6-sol
how critics: gpt-5.6-sol, gpt-5.6-luna, grok-4.6
why investigators: gpt-5.6-luna
why synthesizer: gpt-5.6-sol
reflect tooling: gpt-5.6-luna
reflect judgment, divergent, synthesizer: gpt-5.6-sol
arena runners: gpt-5.6-sol, gpt-5.6-luna, grok-4.6
arena cross-judge pool: gpt-5.6-sol, gpt-5.6-luna, grok-4.6
swarm workers: gpt-5.6-luna
architect runners: gpt-5.6-sol, gpt-5.6-luna, grok-4.6
interrogate reviewers: gpt-5.6-sol, gpt-5.6-luna, grok-4.6
```

### 6. Wire it in

On Claude Code, if `~/.claude/CLAUDE.md` does not already include `~/.claude/pstack-models.md`, append the `@~/.claude/pstack-models.md` line so it loads on every session. If the user prefers project scope, add the include to the project's `CLAUDE.md` instead. On Codex, paste the sheet into `~/.codex/AGENTS.md`.

### 7. Confirm

Tell the user where the override was written and how it loads (the `@` include in CLAUDE.md on Claude Code, or the AGENTS.md paste on Codex). Re-running this skill updates the override sheet.

## Models

Stamped from `plugins/pstack/models.json` (edit there, rerun `tools/generate.mjs`).

- Available models: GPT-5.6 Sol (`gpt-5.6-sol`), GPT-5.6 Luna (`gpt-5.6-luna`), Grok 4.6 (`grok-4.6`), GPT-5.5 (`gpt-5.5`), GPT-5.4 (`gpt-5.4`)
- Default panel: `gpt-5.6-sol`, `gpt-5.6-luna`, `grok-4.6`
- Single-role default: `gpt-5.6-sol`
