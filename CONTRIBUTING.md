# Contributing

Upstream pstack content is mirrored, not curated. This repository owns the Codex and OpenCodex model routing, the Codex runtime contract, and the release tooling.

## Mirror upstream changes

```shell
bun tools/sync.mjs pstack <new-upstream-sha> --json
bun tools/sync.mjs pstack <new-upstream-sha> --apply
```

Preview is the default. `--apply` writes every added, updated, and deleted upstream file and advances the pin. Rendering applies `tools/substitutions.json`, replaces upstream model names in Markdown with `<role model>`, and keeps the port's `menu-description` and `user-invocable` frontmatter. Upstream `disable-model-invocation` is dropped from `SKILL.md` and written as `agents/openai.yaml` with `allow_implicit_invocation: false`. Denylisted Cursor tokens are reported as warnings.

Ownership lives in `tools/upstream.json`:

- `exclude` lists Cursor-only artifacts that cannot run on Codex, each with a reason.
- `portOwned` lists the files the mirror never writes. Upstream edits to them appear under `portOwnedChanged`.
- `remap` moves an upstream file to a Codex location, such as the comment-sicko prompt.

Do not hand-edit a mirrored file; the next sync overwrites it. CI's mirror parity step rebuilds the tree from the pin and fails on the edit. Change Codex behavior through a port-owned file, `models.json`, or the stamped sections in `tools/generate.mjs`.

The scheduled workflow has two jobs. The mirror job runs upstream code with a read-only token, verifies the result, and uploads a patch. The land job runs only this repository's tools. It rejects a patch that touches a port-owned path or edits `tools/upstream.json` beyond the pins. When upstream changed a port-owned file, it opens the PR and waits for a manual merge. Pushes and PRs made with `GITHUB_TOKEN` do not start other workflows, so `ci.yml` does not run on the bot PR; the mirror job's checks are the gate. Keep "Allow GitHub Actions to create and approve pull requests" enabled and leave `main` without required status checks, or switch the workflow to a GitHub App token.

## Verify a change

```shell
bun tools/generate.mjs
bash tests/skill-collision-repro.sh
bun test tests/
```

The generator stamps `VERSION`, public prompt stubs, the command table, the `## Models` and `## Codex runtime` sections, and the bundled routing catalog. It validates profile and catalog references. Do not hand-edit generated model pairs or prompt descriptions. A public skill without `menu-description` uses the first sentence of its `description`. `README_COMMAND_ORDER` fixes the order of known skills and new skills follow alphabetically. Hidden principle leaves use `user-invocable: false`.

For vendored scripts:

```shell
cd plugins/pstack/skills/poteto-mode/scripts
bun install --frozen-lockfile
bun run typecheck
bun test
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
