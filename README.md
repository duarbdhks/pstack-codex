# pstack for Codex

pstack-codex mirrors [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack) for Codex. Upstream skills, playbooks, principles, and scripts are copied as published, including additions and deletions. This repository owns only the Codex and OpenCodex model routing and the Codex runtime contract. Both live in port-owned files and generator-stamped sections.

[tools/upstream.json](tools/upstream.json) records the mirrored upstream revision, the Cursor-only exclusions, and the port-owned paths.

## Install on Codex

Use the Codex marketplace CLI:

```shell
codex plugin marketplace add duarbdhks/pstack-codex
codex plugin add pstack@pstack-codex
codex plugin list --json
```

For a local checkout, pass its path to `codex plugin marketplace add` instead. Confirm the installed version in `codex plugin list`. Installing or refreshing a plugin does not update an already loaded chat's instructions; start a new chat to use the new version.

Each landed upstream change is a new patch version on `main`. Refresh an installed copy with `codex plugin marketplace upgrade pstack-codex`.

Independent copies of the skill directories also work with `.agents/skills` discovery. The routing catalog is generated into the `poteto-mode/scripts` directory so a copied skill does not depend on a checkout above it. Refresh copies deliberately; they do not follow Git automatically.

## Start a task

Invoke `$pstack:poteto-mode` for a concrete task and give it an observable finish condition. Like upstream, pstack skills run only when invoked; they are not injected into every chat. It chooses a playbook, grounds the affected code, assigns bounded work, and checks the actual result. A CLI change runs the command; a UI change drives the affected flow; a storage change reads the result back.

Use `/setup-pstack` to inspect or change your role selections. Existing fixed pairs and OCX selections keep their meaning. Adaptive routing is a choice for specific roles. It requires a compatible policy and does not silently rewrite your global instructions or change OpenCodex.

[Codex routing](plugins/pstack/skills/poteto-mode/references/codex-routing.md) defines `route.mjs resolve`, `escalate`, and `verify`. It selects a model and effort together, validates against the active spawn tool, preserves panel slots, and compares the requested selection with the child's actual receipt. Its three task axes are difficulty, failure cost, and reasoning depth. These are capability and effort tiers, not measured prices.

Use `/correct` explicitly when agents repeat a mistake. It finds recurring classes in repository history and adds mechanisms that fail on real past mistakes. Use `/benchmark-checklist` before acting on a performance number. It checks tuning, errors, actual work, repeatability, relevance, and the limiter behind the result.

## Native execution contract

[Codex tools](plugins/pstack/skills/poteto-mode/references/codex-tools.md) is the Codex entry point. It uses the current tool definitions, explicit model and reasoning effort, bounded context forks, scoped child transcripts, and available shell or UI drivers. It does not assume a plugin hook or scheduler exists. The resolver computes selections; the parent performs native dispatch and verifies its receipt.

Shared skills may retain upstream names for tools. [Legacy tool mappings](plugins/pstack/skills/poteto-mode/references/legacy-tools.md) preserve the Claude Code and Grok paths. Those adapters do not override Codex's selection policy. Other runtimes can discover the shared skills through `.agents/skills`; native dispatch integration is verified on Codex, not on those runtimes.

Fresh children handle independent tasks and new fix rounds. A child is reused when its live process, checkout, or unrecovered edits are needed to continue the same task. Preserve that work before replacing it.

## Upstream mirror

The scheduled workflow runs every six hours. It mirrors each upstream change, bumps the patch version, regenerates the stamped sections, and runs the release checks. A clean run opens and squash-merges a sync PR. An upstream change to a port-owned file waits for a manual merge. A run that cannot land opens or updates one issue titled "Upstream sync needs attention". The next landed or current run closes it.

```shell
bun tools/sync.mjs pstack <upstream-sha> --json
bun tools/sync.mjs pstack <upstream-sha> --apply
```

Preview is the default. `--apply` writes the mirror and advances the pin. Port-owned paths are never written; upstream edits to them are listed under `portOwnedChanged` for a manual look. Upstream model names in prose become `<role model>`. Upstream `disable-model-invocation` becomes `agents/openai.yaml` with implicit invocation off. See [CONTRIBUTING.md](CONTRIBUTING.md) for the ownership rules.

## Maintenance

- `VERSION` owns the release version. `CHANGES.md` explains each release.
- `plugins/pstack/models.json` owns model metadata, role names, and adaptive profiles. `tools/generate.mjs` produces the bundled catalog and model documentation from it.
- Public skill frontmatter owns Codex prompt descriptions and the command table below.
- `tests/` checks routing, mirror sync, generation, and plugin invariants with positive and negative fixtures.
- `poteto-mode/scripts/` ships the resolver, PR watcher, orchestration store, and worktree audit. Existing script dependencies stay pinned by `bun.lock`.

CI checks generated files, mirror parity with the pinned upstream, plugin invariants, Bun tests, vendored TypeScript tools, shell scripts, pinned actions, and workflow security. The scheduled upstream mirror is separate from release CI.

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
| `/create-formal-verification-skill` | Generate a project-local skill that formally verifies the code where a bug costs the most and tests reach the least, in any language, with whichever verification tool fits |
| `/in-your-own-words` | Restate in your own words what you think the user's goals are and what problem they're trying to solve |
| `/ketchup` | Catch the user up on what changed in this chat since their last message, in plain words and small visuals |
| `/maintain-formal-verification-skill` | Bring a project's formal verification back in line with the code after the code changes: find the commits that touched verified code, update the model, harness, or properties to describe the code as it is now, rerun, and say whether each failure is drift in the verification or a bug in the code |
| `/poteto-help` | Guides users through pstack setup, /poteto-mode, and picking the skill, playbook, or principle for a task |
| `/sharpen` | Make a task deeper, not bigger, then rewrite the prompt |

## License

MIT. [LICENSE](LICENSE) preserves Lauren Tan's pstack attribution. [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit) covers the seven imported team-kit skills: `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, and `what-did-i-get-done`. Historical port changes are recorded in [CHANGES.md](CHANGES.md) and [NOTICE.md](NOTICE.md).
