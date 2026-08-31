# Codex tool mapping for pstack

pstack skills are written in Claude Code tool language (the `Skill` tool, the `Agent` tool, `AskUserQuestion`). Model slugs are the Codex+Grok catalog stamped from `models.json`. On Codex the skills are the same files; tool names resolve through this map, and model slugs work as written. On Claude Code, substitute the sidecar catalog via `/setup-pstack`. Read this when a pstack skill names a Claude tool, a Claude built-in skill, or a model slug.

## Tool actions

| pstack / Claude action | Codex equivalent |
|------------------------|------------------|
| Read a file | `shell` (`cat`, `head`, `tail`) |
| Create / edit / delete a file | `apply_patch` |
| Run a shell command | `shell` |
| Search file contents / find files | `shell` (`rg`, `grep`, `find`, `ls`) |
| Fetch a URL | `shell` with `curl` / `wget` |
| Search the web | `web_search` |
| Invoke a skill (the `Skill` tool, `/command`) | Skills load natively. Follow the instructions presented. |
| Dispatch a subagent (the `Agent`/`Task` tool) | `spawn_agent` |
| Dispatch N parallel subagents in one turn | N `spawn_agent` calls in one response |
| Wait for a subagent result | `wait_agent` |
| Free a finished subagent slot | `close_agent` |
| Track tasks (the todolist / `TodoWrite`) | `update_plan` |
| Ask the human a fixed-choice question (`AskUserQuestion`) | Ask in plain text and let the user answer. Codex has no structured-choice tool. |

Subagent dispatch needs `multi_agent` enabled. Add to `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

Without it, `spawn_agent` is unavailable and the fan-out skills (`interrogate`, `why`, `how`, `arena`, `reflect`) degrade to a single sequential pass.

## Subagent policy

poteto-mode's Subagents section sets Claude-specific defaults (`subagent_type: "poteto-agent"`, `run_in_background: true`). Those strings are Claude names. Do not register `poteto-agent` as a new Codex or Grok type. Translate at spawn time.

### Type translation

| Skill name | Codex | Grok |
|------------|-------|------|
| `poteto-agent` | `spawn_agent` with `agent_type="default"`; `task_name="poteto-agent"`; prompt reads the `poteto-mode` skill's `SKILL.md` in full first, including Principles | `spawn_subagent` with `subagent_type="pstack:poteto-agent"`; prompt still reads that skill in full first |
| `general-purpose` | `agent_type="default"` | `subagent_type="general-purpose"` |
| `comment-sicko` | `agent_type="default"`; prompt reads `agents/comment-sicko.md` in full first | `subagent_type="pstack:Comment Sicko"` |

`explore` / `explorer` are not pstack role carriers. Investigation roles stay on this map: Codex `default` plus the Luna row in `pstack-models.md`. Grok's built-in `explore` is read-only lookup, not a poteto implementation delegate.

If a runtime rejects the translated type, stop. Do not silently substitute Codex `worker` or Grok `general-purpose`. Those skips drop the skill read and let the type own model or effort.

On Codex:

- Use the `default` Codex agent type for every pstack role. Do not translate semantic roles into Codex types such as `worker`, `reviewer`, or `explorer`. A specialized type can own its model and reasoning effort. Put the pstack role in `task_name` and the prompt instead.
- Resolve `model` from `~/.codex/pstack-models.md`. Resolve `reasoning_effort` from the active `AGENTS.md` policy. Pass both fields explicitly. Do not dispatch until both values resolve.
- Set `fork_turns` to `"none"` by default. Use a positive bounded count only when the task needs recent history.
- `spawn_agent` calls already run concurrently with your turn, so `run_in_background: true` has no separate flag. Issue the dispatch and continue.

On Grok:

- Plugin agents are `plugin-name:agent-name`. The pstack agent is `pstack:poteto-agent`, not `poteto-agent`.
- Resume an existing poteto child with `resume_from` rather than spawning a sibling.
- Omit `model` unless the user named one. Grok spawn has no `reasoning_effort` field.

Shared:

- Claude Code runs every subagent on this machine, so the **swarm** skill's workers and the fan-out playbooks (`orchestrate`, `autopilot-full`, `autopilot-stack`) isolate writers with worktrees. The same holds on Codex and Grok.
- Keep the rest of the policy unchanged. Pass file pointers not inlined context, give each worker its own worktree or branch when they write, review every subagent's diff yourself.

## Codex spawn contract

```json
{
  "agent_type": "default",
  "task_name": "<semantic role>",
  "model": "<configured model>",
  "reasoning_effort": "<configured effort>",
  "fork_turns": "none",
  "prompt": "<complete task, constraints, and file pointers>"
}
```

## Model names

Skills name Codex+Grok defaults (a single-role default for code/prose/judgment plus a diverse-model panel; each model-consuming skill lists its own in a Models section). These slugs do not resolve on Claude Code. On Claude Code substitute the sidecar catalog (single-role `claude-opus-5`, panel `claude-opus-5`, `claude-fable-5`, `claude-sonnet-5`) via `/setup-pstack`. On Codex they work as written. On Grok, map through the runtime adapter below.

- Single-model roles: judgment, implementation, and synthesis use `gpt-5.6-sol`; exploration and volume work use the explorer/worker roles stamped per skill.
- Diverse-model panels (`arena`, `architect`, `interrogate`, `how` critics): `gpt-5.6-sol`, `gpt-5.6-luna`, `grok-4.6`. If a runtime cannot reach a family, vary remaining models and note that diversity was reduced.

Runtime adapter (canonical slug to spawn id):

- Codex: `gpt-5.6-sol` stays `gpt-5.6-sol`; `gpt-5.6-luna` stays `gpt-5.6-luna`; `grok-4.6` becomes `xai/grok-4.6` when the OpenCodex Grok override is active, otherwise skip that panel seat or pick another available family.
- Grok: `gpt-5.6-sol` becomes `ocx-gpt-5-6-sol`; `gpt-5.6-luna` becomes `ocx-gpt-5-6-luna`; `grok-4.6` stays `grok-4.6`.

`/setup-pstack` writes the configured model list.

## Claude built-in skills pstack references

Some triggers name skills that ship with Claude Code, not pstack. They do not exist on Codex. Substitute the behavior:

| Claude built-in named in pstack | On Codex |
|---------------------------------|----------|
| `run` (drive a CLI/TUI to see a change work) | Run the app yourself via `shell` and observe the real output. |
| `verify` (drive a UI to confirm a fix) | Drive the UI with whatever automation you have, or hand the user a concrete manual check. Do not claim done without observing the artifact. |
| `plugin-dev:skill-development` (Claude's SKILL.md authoring guidance) | Follow your platform's skill-authoring guidance; the `writing-skills` skill if present. Keep `name` + `description` frontmatter and progressive disclosure. |
| `loop` (recurring/self-paced re-invocation, used by `babysit`) | Codex has no `loop` skill. Re-run the step yourself on a cadence, or use a Codex scheduled task if available. |

## Vendored scripts

`skills/poteto-mode/scripts/` ships the `watch-pr` PR watcher, the `orch` store CLI, and `worktree-audit.sh`. They are plain bun and bash, so they run the same on Codex; invoke them through `shell`. They need `bun`, `gh`, (for stack work) `gt`, and (for `worktree-audit.sh`) `jq` and `rg`. `worktree-audit.sh` reads Claude Code transcripts under `~/.claude/projects/`; point it at your runtime's transcript directory instead when you run it elsewhere.

## Instructions file

Where a pstack skill says "your instructions file", on Codex that is `AGENTS.md` (project root, plus `~/.codex/AGENTS.md` global). On Claude Code it is `CLAUDE.md`.
