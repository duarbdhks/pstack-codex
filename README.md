# pstack for Codex

pstack-codex turns [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack) into a Codex engineering workflow. Shared principles and playbooks stay comparable with upstream. This repository owns Codex model routing, subagent execution, tool selection, verification, and release checks.

The 0.10.0 changes selectively absorb upstream pstack 0.15.9 at `e43c7ee`. [The comparison and adoption record](docs/changes/0.10.0/README.md) explains the choices. [tools/upstream.json](tools/upstream.json) records the last fully reviewed revision; reviewing a newer revision does not mean copying every feature.

## Install on Codex

Use the Codex marketplace CLI:

```shell
codex plugin marketplace add duarbdhks/pstack-codex
codex plugin add pstack@pstack-codex
codex plugin list --json
```

For a local checkout, pass its path to `codex plugin marketplace add` instead. Confirm the installed version in `codex plugin list`. Installing or refreshing a plugin does not update an already loaded chat's instructions; start a new chat to use the new version.

Independent copies of the skill directories also work with `.agents/skills` discovery. The routing catalog is generated into the `poteto-mode/scripts` directory so a copied skill does not depend on a checkout above it. Refresh copies deliberately; they do not follow Git automatically.

## Start a task

Use `pstack:poteto-mode` for a concrete task and give it an observable finish condition. It chooses a playbook, grounds the affected code, assigns bounded work, and checks the actual result. A CLI change runs the command; a UI change drives the affected flow; a storage change reads the result back.

Use `/setup-pstack` to inspect or change your role selections. Existing fixed pairs and OCX selections keep their meaning. Adaptive routing is a choice for specific roles. It requires a compatible policy and does not silently rewrite your global instructions or change OpenCodex.

[Codex routing](plugins/pstack/skills/poteto-mode/references/codex-routing.md) defines `route.mjs resolve`, `escalate`, and `verify`. It selects a model and effort together, validates against the active spawn tool, preserves panel slots, and compares the requested selection with the child's actual receipt. Its three task axes are difficulty, failure cost, and reasoning depth. These are capability and effort tiers, not measured prices.

Use `/correct` explicitly when agents repeat a mistake. It finds recurring classes in repository history and adds mechanisms that fail on real past mistakes. Use `/benchmark-checklist` before acting on a performance number. It checks tuning, errors, actual work, repeatability, relevance, and the limiter behind the result.

## Native execution contract

[Codex tools](plugins/pstack/skills/poteto-mode/references/codex-tools.md) is the Codex entry point. It uses the current tool definitions, explicit model and reasoning effort, bounded context forks, scoped child transcripts, and available shell or UI drivers. It does not assume a plugin hook or scheduler exists. The resolver computes selections; the parent performs native dispatch and verifies its receipt.

Shared skills may retain upstream names for tools. [Legacy tool mappings](plugins/pstack/skills/poteto-mode/references/legacy-tools.md) preserve the Claude Code and Grok paths. Those adapters do not override Codex's selection policy. Other runtimes can discover the shared skills through `.agents/skills`; native dispatch integration is verified on Codex, not on those runtimes.

Fresh children handle independent tasks and new fix rounds. A child is reused when its live process, checkout, or unrecovered edits are needed to continue the same task. Preserve that work before replacing it.

## Upstream review

The scheduled workflow reports candidate changes and uploads JSON artifacts. It has read-only repository permissions and does not push or merge.

```shell
bun tools/sync.mjs pstack <upstream-sha> --json
```

Each changed path needs a revision-bound decision to adopt, adapt, exclude, or defer it. `--apply` writes only a fully reviewed batch. `--finalize` also runs the core release checks before advancing the pin. New files and deletions need decisions too. A local adaptation is checked against its reviewed content hash. Unresolved changes, stale decisions, denylist hits, or failed checks hold the pin. See [CONTRIBUTING.md](CONTRIBUTING.md) for the review document and commands.

## Maintenance

- `VERSION` owns the release version. `CHANGES.md` explains each release.
- `plugins/pstack/models.json` owns model metadata, role names, and adaptive profiles. `tools/generate.mjs` produces the bundled catalog and model documentation from it.
- Public skill frontmatter owns Codex prompt descriptions and the command table below.
- `tests/` checks routing, reviewed sync, generation, and plugin invariants with positive and negative fixtures.
- `poteto-mode/scripts/` ships the resolver, PR watcher, orchestration store, and worktree audit. Existing script dependencies stay pinned by `bun.lock`.

CI checks generated files, plugin invariants, Bun tests, vendored TypeScript tools, shell scripts, pinned actions, and workflow security. The scheduled upstream review is separate from release CI.

## Slash commands

| command | use it when |
| --- | --- |
| `/poteto-mode` | default entry point for any non-trivial task |
| `/how` | walk through how a subsystem works |
| `/why` | investigate why something was built this way (parallel multi-MCP evidence) |
| `/architect` | settle types and module shape before writing code that crosses a function boundary |
| `/arena` | run N parallel attempts at the same task and pick the best parts |
| `/interrogate` | have multiple models try to break a diff |
| `/automate-me` | draft your own personal -mode skill from recent transcripts |
| `/reflect` | capture a long task's lessons as a skill edit |
| `/correct` | turn mistakes agents repeat in this repo into checks that make them impossible |
| `/tdd` | fix a bug by writing the failing test first, then the fix |
| `/typescript-best-practices` | ground type-system discipline in TypeScript syntax |
| `/teach` | explain a subsystem plainly by composing how + why |
| `/swarm` | fan out N parallel workers across slices or races, then return one aggregated report |
| `/technical-writing` | write docs, RFCs, readmes, PR descriptions, and commit messages to one layered standard |
| `/bro` | restate the last message in plain human language, no jargon |
| `/figure-it-out` | design a rigorous, auditable playbook for a task no bundled playbook fits |
| `/show-me-your-work` | log decisions to a reviewable tsv decision trail |
| `/blast-radius` | find what a change could break beyond the diff and prove safety by running code |
| `/recall` | catch up on recent working context from chat history, live state, and the shared record |
| `/setup-pstack` | configure pstack per-role model choices |
| `/unslop` | clean up writing by removing AI tells |
| `/no-comments` | strip comments before review, fix the accepted findings, encode claimed constraints |
| `/create-verification-skill` | generate a project-local verification skill and feature map |
| `/maintain-verification-skill` | re-sync a drifted verification skill and its feature map |
| `/benchmark-checklist` | vet a measured speedup or regression before you report or act on it |
| `/deslop` | deslop a diff before commit |
| `/babysit` | monitor an open PR, fix CI/comments, keep it merge-ready |
| `/thermo-nuclear-code-quality-review` | extremely strict maintainability audit |
| `/make-pr-easy-to-review` | clean noisy history and improve PR description before review |
| `/fix-ci` | find failing PR checks, inspect logs, apply focused fixes |
| `/fix-merge-conflicts` | non-interactively resolve merge conflicts, validate, finalize |
| `/get-pr-comments` | fetch and summarize review comments from the active PR |
| `/what-did-i-get-done` | summarize authored commits over a user-chosen period |

## License

MIT. [LICENSE](LICENSE) preserves Lauren Tan's pstack attribution. [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) covers the seven imported team-kit skills: `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, and `what-did-i-get-done`. Historical port changes are recorded in [CHANGES.md](CHANGES.md) and [NOTICE.md](NOTICE.md).
