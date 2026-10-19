# 0.10.0 adoption and verification

This change adds opt-in executable routing and strengthens the Codex execution contract. It selectively takes ideas from Cursor pstack 0.15.9, rather than making matching upstream files the objective. The base is local `6304662` / 0.9.24. The upstream comparison is `12d587d` to `e43c7ee`: four pstack commits, 21 changed files, of which 16 are inside this port's review boundary.

## Adoption decisions

| Area | Decision | Reason |
| --- | --- | --- |
| `/correct` | Adapt | Explicit user invocation; repository-scoped history; recurring classes need real negative proof. Global memory and unrelated cleanup stay outside the skill. |
| Performance measurement | Adopt and adapt | The checklist and Explain the Number principle check failures, actual work, tuning, limits, repeatability, and relevance. Driver examples support macOS and Linux. |
| Performance playbooks | Adapt | Try eliminating unused work first. Hillclimb borrows the order, retains its own stopping predicate, and checks completed user work. |
| Agent-resistant design | Adopt | Screen split ownership, duplicate paths, exposed internals, and manually synchronized lists. Reject forwarding layers used only to satisfy a flag. |
| Fresh children | Adapt | Independent tasks and changed fix rounds use fresh contexts; live processes and unrecovered changes justify continuing the same child. |
| PR briefing and schema-first examples | Adapt | Native available tools, artifact attachment, existing authorization, and a schema-derived boundary example. |
| Cursor model strings and budget suffixes | Exclude | Codex has separate exact model IDs and reasoning effort. The active spawn contract controls support. |
| Cursor cloud workers, sticky mode, bot UI, Benny | Exclude | They need a different runtime or an unrequested product integration. |
| Hourly autopilot ticks and automatic pushes | Exclude | Existing native scheduling and authorization boundaries remain. A timer change would also require revisiting the plan checker. |
| Technical-writing source-line deletion | Exclude | The existing source pointers remain useful; deleting attribution is not part of this improvement. |
| Existing generated SSOT and explicit OCX pairs | Preserve | These are already stronger than coupled model/effort slugs and hand-maintained copies. |

Upstream motivations and its own evaluation limitations are in [the correct PR](https://github.com/cursor/plugins/pull/494), [the architect PR](https://github.com/cursor/plugins/pull/495), and [the performance PR](https://github.com/cursor/plugins/pull/496). Those evaluations are not Codex quality evidence.

## Codex-owned design

`models.json` owns profiles and role metadata. The generator produces the routing table, legacy remaps, and a bundled catalog so independent skill copies can execute the same policy. The highest task demand selects the tier. Model prices are not inferred from names.

The native resolver preserves fixed pairs, per-slot OCX fallbacks, array order, and duplicates. It distinguishes candidate pools from panels. Adaptive requires explicit policy support and a selected profile. It validates against the active tool contract, permits one verified capability escalation, and compares requested pairs with the exact child's final context. It does not enforce every tool call through a hook or change the user's existing global files.

The sync tool now reviews changed upstream content first, binds decisions to source and local hashes, and holds writes or the pin on unresolved work. The scheduled workflow uploads reports with read-only permissions. The obsolete bot push planner is removed. Shared skill names and existing public commands remain; the two new public commands are `correct` and `benchmark-checklist`.

## Behavioral proof

[proofs.json](proofs.json) records three scenarios, one run per arm, using the same Opus 5.5/high selection. Each arm read the relevant old or new guidance in an isolated project. This exercises the instructions themselves; it does not prove that an already-open chat has loaded the released plugin.

| Scenario | Previous guidance | New guidance | Observation |
| --- | --- | --- | --- |
| Repeated invoice-state omission | Removed the duplicate state list and added checks | Same result, with the explicit recurring-class procedure | Both passed 3 tests, failed when a real fixture-history mistake was restored, and preserved the public API and one-off title fix. |
| Claimed 10x performance gain | Rejected failed responses as a speedup | Rejected them and named measurement gaps | Both identified zero successful work in the changed runs. |
| Webhook design | Identified ownership, duplication, leakage, and forwarding issues | Identified those issues and required build enforcement of internal imports | Both avoided another forwarding layer. No implementation performance or general quality score was measured. |

Both native adaptive examples also completed with matching receipts: Luna/medium read the actual state list; Sol/medium implemented `--json` and preserved plain output byte-for-byte. The first Sol attempt ended with provider 429 before editing. Its unchanged file was checked before one retry on the same pair. This was a transport retry, not capability escalation.

## Verification record

Root routing, reviewed-sync, generation, and negative invariant fixtures pass. Vendored TypeScript tools retain their frozen lockfile and pass typecheck and 55 tests. Shellcheck covers the three shipped shell scripts. Zizmor 1.29.0 reports no findings for the workflows and Dependabot configuration in its default offline mode.

The final exact command results are recorded in [verification.json](verification.json). Bun 1.3.14 is tested separately from the installed Bun 1.4.2. Generation checks include a real copied fixture, a changed profile, repeated generation, and a standalone copied routing script.

## Next priorities

1. Calibrate the profiles with more representative tasks, failure rates, token usage, and end-to-end time. Current examples do not establish savings or general quality improvement.
2. Expand blinded comparisons across tasks and available model families. Keep correctness and recovery gates ahead of speed.
3. Adapt long-running automation and legacy worktree-history evidence when a concrete Codex use case needs them. No generic scheduler is added in this release.

Runtime compatibility and installed skill updates remain separate from this repository change. Existing global OCX settings are preserved and the working tree has not been pushed or installed globally.
