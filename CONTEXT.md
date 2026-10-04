# Context and ownership

- **Shared workflow** is an upstream-derived principle or playbook. Keep its provenance and record deliberate behavioral differences.
- **Native contract** is pstack-codex's definition of Codex tool use, dispatch, configuration, and evidence. It owns those behaviors rather than inheriting a legacy runtime's syntax.
- **Model catalog** is `plugins/pstack/models.json`. It owns role metadata and adaptive profiles; it does not list the runtime's currently supported spawn pairs.
- **User selection** is a fixed pair, an OCX selection with a complete fallback, or an explicitly enabled adaptive profile in `pstack-models.md`.
- **Panel** preserves configured slot count, order, and duplicates. Slots resolving to one model provide independent contexts, not vendor diversity.
- **Receipt** records requested model and effort and compares them with the exact child's final `turn_context`.
- **Generator-owned copy** is a prompt, model section, or bundled catalog produced by `tools/generate.mjs`. The source catalog and skill frontmatter are edited instead.
- **Review pin** is the last fully reviewed upstream revision in `tools/upstream.json`. It advances only after decisions are complete and core verification succeeds.
- **Review decision** binds an adoption, adaptation, exclusion, or deferral to source content. Adaptation and exclusion also bind the reviewed local content.
- **Release** changes `VERSION`, records `CHANGES.md`, regenerates the plugin manifest, and passes affected checks. Updating installed copies is a separate operation.
