# Legacy runtimes: Claude Code and Grok

pstack keeps upstream skill names and workflows, so skill prose still uses Claude Code tool names. Codex is the main path; see [`codex-tools.md`](codex-tools.md). This file holds what other runtimes need.

## Claude Code

- Tools are named in skill prose directly: `Read`, `Edit`, `Bash`, `Agent`/`Task` (`subagent_type`, `run_in_background`), `AskUserQuestion`, `TodoWrite`, `Skill`.
- Model choices come from `~/.claude/pstack-models.md`, written by the Claude Code section of `/setup-pstack` and included from `CLAUDE.md`. `inherit-parent` and `auto` mean omitting `model`.
- Project skills live under `.claude/skills/`; the instructions file is `CLAUDE.md`.
- Transcripts live at `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`, where `<encoded-cwd>` is the workspace path with the leading slash dropped and each `/` turned into `-`. Read only the active workspace's directory.

## Grok

| Skill name | Grok |
|------------|------|
| `poteto-agent` | `spawn_subagent` with `subagent_type="pstack:poteto-agent"`; the prompt reads the `poteto-mode` skill in full first |
| `general-purpose` | `subagent_type="general-purpose"` |
| `comment-sicko` | `subagent_type="general-purpose"`; the prompt reads `plugins/pstack/skills/no-comments/references/comment-sicko.md` in full first |

- Plugin agents are `plugin-name:agent-name`.
- Resume an existing poteto child with `resume_from` rather than spawning a sibling.
- Omit `model` unless the user named one. Grok spawn has no `reasoning_effort` field.
- Grok's built-in `explore` is read-only lookup, not a poteto implementation delegate.
- Model slug remaps are generated in the Model names section below.

If a runtime rejects the translated type, stop. Do not substitute another type silently.

## Model names

Legacy Grok mappings, stamped from `models.json`.

`gpt-6.1-sol` becomes `ocx-gpt-6-1-sol`. `gpt-6-astra` becomes `ocx-gpt-6-astra`. `gpt-6-luna` becomes `ocx-gpt-6-luna`.
