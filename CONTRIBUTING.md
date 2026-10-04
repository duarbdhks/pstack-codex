# Contributing

Shared skills keep their upstream provenance. Codex routing, execution, tool use, verification, and release tooling belong to this repository. A behavioral improvement can be designed here when it serves Codex; record why it is adopted, adapted, or deliberately omitted.

## Review upstream changes

```shell
bun tools/sync.mjs pstack <new-upstream-sha> --json
```

The default is read-only. It compares the old and new upstream trees first, so unchanged upstream files retain their local adaptations without false conflicts. The report includes added, updated, and deleted paths. Exclusions in `tools/upstream.json` protect Cursor-only trees.

Review decisions live in `tools/upstream-review.json`. Each component records `from`, `to`, and a `decisions` array. Each decision has `path`, the report's source `revision`, `action`, and a concrete `reason`. Actions are `adopt`, `adapt`, `exclude`, and `defer`. A deletion uses `revision: null`. `adapt` and `exclude` also record the report's `localRevision`, including null for a missing local file. A source or local edit invalidates the corresponding decision.

```shell
bun tools/sync.mjs pstack <new-upstream-sha> --review tools/upstream-review.json --apply
bun tools/sync.mjs pstack <new-upstream-sha> --review tools/upstream-review.json --finalize
```

`--apply` writes an entirely reviewed batch and holds the pin. A mechanical adoption must match the old translated file or already match the new target; hand-adapted content uses `adapt`. No partial writes occur when a candidate is unresolved, deferred, or contains a denied runtime token. `--finalize` runs the generator, plugin invariants, and root Bun tests before advancing the pin. When using a local `--source` cache, finalization also checks that the target commit is reachable from the registered upstream. A failed command leaves the pin in place and retains the diff for inspection. Run the other affected checks below before finalizing a release.

The scheduled workflow uploads reports with read-only permissions. It no longer maintains or merges a bot branch. Previously opened sync PRs remain ordinary PRs requiring review. `tools/substitutions.json` keeps the historical translation boundary for shared content; native contracts are port-owned and reviewed as adaptations.

## Verify a change

```shell
bun tools/generate.mjs
bash tests/skill-collision-repro.sh
bun test tests/
```

The generator stamps `VERSION`, public prompt stubs, the command table, role defaults, and the bundled routing catalog. It validates profile and catalog references. Do not hand-edit generated model pairs or prompt descriptions. Add new public skills to `README_COMMAND_ORDER` and give them `menu-description`; hidden principle leaves use `user-invocable: false`.

For vendored scripts:

```shell
cd plugins/pstack/skills/poteto-mode/scripts
bun install --frozen-lockfile
bun run typecheck
bun test orch watch-pr
```

For shell scripts, run shellcheck. For workflow changes, match CI's audit:

```shell
uvx zizmor@1.29.0 --persona pedantic --min-severity low --collect all -- .
```

Keep actions pinned to full commit SHAs. The `--collect all` audit also reads Dependabot configuration. Dependency changes require a matching lockfile update.

Routing checks use fixtures for deterministic outcomes and native child receipts for dispatch proof. Static tests alone do not establish agent quality or savings. A behavior comparison records the task, environment, requested and actual selections, output checks, sample count, and limitations. Work only in isolated fixture directories.

## Release

Set `VERSION`, add its `CHANGES.md` heading, and regenerate. Installed plugins update by version, so a skill change without a version bump does not reach existing users. Global configuration, installed skill copies, pushes, and deployment are separate actions requiring the corresponding user request.

Use Korean commit messages and PR descriptions. Describe the resulting behavior and the checks actually run. Preserve unrelated local edits, and claim no broader validation than the evidence supports.
