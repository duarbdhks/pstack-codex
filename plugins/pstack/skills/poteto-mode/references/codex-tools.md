# Codex tool mapping for pstack

pstack skills keep upstream wording (`Skill`, `Agent`, `AskUserQuestion`) so workflows stay comparable with upstream. On Codex, resolve each action through this map. Model and effort resolve through [`codex-routing.md`](codex-routing.md). Claude Code and Grok specifics live in [`legacy-tools.md`](legacy-tools.md).

## Capability discovery

The tool list of the current turn is the only source of truth. Availability changes with Codex version, surface (CLI, app, cloud), mode (Plan or Default) and the user's config, so this file names candidates, not guarantees. Before a step depends on a tool, check that it is listed. When it is absent, use the fallback in the table and say which capability was missing. Never claim a capability from a config flag, a doc, or a previous session.

## Tool actions

| pstack / upstream action | Codex tool when listed | Fallback when absent |
|--------------------------|------------------------|----------------------|
| Read, search, run a command | `exec_command` (`rg`, `sed -n`, `cat`) | none needed |
| Long-running or interactive process | `exec_command` returns a session id; poll or type with `write_stdin` | run to completion with a timeout |
| Create, edit, delete a file | `apply_patch` | none needed |
| Fetch a URL | `exec_command` with `curl`, when network is allowed | ask the user for the content |
| Search the web | the listed web search tool, such as `web.run` | report the gap |
| Invoke a skill (`Skill`, `/command`) | native skills; read the listed `SKILL.md` | read the file by path |
| Dispatch a subagent (`Agent`/`Task`) | `spawn_agent` per [Subagent policy](#subagent-policy) | one sequential pass, stated in the report |
| Wait for, message, close a subagent | the wait, message and close tools in the list (names differ by version, e.g. `wait_agent`, `send_input`, `close_agent`) | none |
| Track tasks (`TodoWrite`) | `update_plan` | a short plan in commentary |
| Fixed-choice question (`AskUserQuestion`) | `request_user_input` or its async variant (`request_user_input_async`) | ask in the final message and stop on that question |
| Look at an image | `view_image` | describe the gap |
| Deferred or connector tools | the listed tool catalog or `tool_search`; use MCP resource tools only for resources | report the gap |
| Lifecycle hook | Codex hooks, only if the user's installed version and config define one | run the check explicitly at that step |
| Recurring re-run (`loop`) | app automations (heartbeat) when listed | re-run the step yourself |

Never skip a repository's git hooks (`--no-verify`). Do not edit the user's Codex config to enable a missing tool; report it.

## Subagent policy

Shared workflows may name `poteto-agent` or `general-purpose`. Translate their semantic role at dispatch; Codex uses the native contract below.

| Skill name | Codex |
|------------|-------|
| `poteto-agent` | `agent_type="default"`, `task_name="poteto-agent"`; the prompt reads the `poteto-mode` skill's `SKILL.md` in full first, including Principles |
| `general-purpose` | `agent_type="default"` |
| `comment-sicko` | `agent_type="default"`; the prompt reads `plugins/pstack/skills/no-comments/references/comment-sicko.md` in full first |

- Use `agent_type="default"` for every pstack role. A specialized type (`worker`, `reviewer`, `explorer`) can own its model and effort. Put the role in `task_name` and the prompt. If the runtime rejects `default`, stop.
- Resolve `model` and `reasoning_effort` as one pair per [`codex-routing.md`](codex-routing.md) and pass both explicitly. An omitted model inherits the parent; it does not select the role. If either field is missing, mismatched or unsupported by the listed spawn contract, stop before spawning.
- `fork_turns` is `"none"` by default. Use a positive bounded count only when the child needs recent turns. Never fork full history with a model or effort override.
- `spawn_agent` already runs concurrently with your turn; `run_in_background` has no separate flag.
- Record role, model, effort and source before each batch. The child's final `turn_context` is the receipt of what actually ran; see [Receipts](codex-routing.md#receipts).
- Isolate writers with worktrees or disjoint file sets. Pass file pointers, not inlined context. Review every child diff yourself.

## Codex spawn contract

```json
{
  "agent_type": "default",
  "task_name": "<semantic role>",
  "model": "<configured model>",
  "reasoning_effort": "<configured effort>",
  "fork_turns": "none",
  "message": "<complete task, constraints, and file pointers>"
}
```

## Model names

Catalog defaults are stamped from `models.json`. The active spawn contract determines which exact model and effort pairs can run.

- Catalog fallback for unlisted judgment: `gpt-6-astra`. Named defaults appear in each skill's Models section.
- Default panel catalog: `gpt-6-astra`, `gpt-6.1-sol`, `grok-4.7`. `arena`, `architect`, and `interrogate` use the subsets in their Models sections.

Runtime selection:

Resolve every role and panel slot through `~/.codex/AGENTS.md` and the YAML in `~/.codex/pstack-models.md`. Keep explicit fixed selections. OCX selections follow the injected model and effort unchanged, or use their complete fallback pair. Adaptive selections use the task profile only when the user has enabled that policy. Preserve all panel slots, even when models repeat. Use the executable resolver and receipt checks in [Codex routing](codex-routing.md). `auto` and `inherit-parent` are legacy aliases, not Codex selections.

## Upstream built-in skills

Some upstream triggers name Claude Code built-ins. On Codex:

| Upstream built-in | On Codex |
|-------------------|----------|
| `run` | Run the app with `exec_command` (PTY via `write_stdin`) and observe real output. |
| `verify` | Use the project's `.agents/skills/verify-<app>/` skill if present; otherwise drive the UI with a listed browser or desktop tool, or hand the user a concrete manual check. Do not claim done without observing the artifact. |
| `plugin-dev:skill-development` | Follow Codex skill-authoring guidance (`skill-creator` if listed). Keep `name` and `description` frontmatter and progressive disclosure. |
| `loop` | App automations when listed; otherwise re-run the step on a cadence yourself. |

## Vendored scripts

`skills/poteto-mode/scripts/` ships `watch-pr`, the `orch` store CLI, `worktree-audit.sh` and the `route.mjs` routing CLI. Run them with `exec_command`. The routing helper needs Bun. Existing watcher/store commands use their vendored Bun dependencies; stack work also needs `gh` and `gt`. `worktree-audit.sh` uses `jq` and `rg` and currently reads Claude Code history. On Codex, absent native chat evidence is a gap; do not treat its legacy recent-chat classification as proof that a worktree is unused.

## Instructions file

"Your instructions file" means `AGENTS.md`: the project's, plus the global one under `~/.codex/`. Codex prefers `AGENTS.override.md` over `AGENTS.md` at the same level when it exists.
