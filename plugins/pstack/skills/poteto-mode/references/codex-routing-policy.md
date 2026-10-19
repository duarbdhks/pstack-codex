# pstack routing policy block

This is the canonical selection-forms passage for the global `~/.codex/AGENTS.md`. It allows three forms, fixed, OCX and adaptive, side by side. `/setup-pstack` installs or migrates it only when the user asks, following [Install rules](#install-rules). The marker carries the version.

## Block

```markdown
<!-- pstack-routing:1 -->
Each default, role and panel slot in `~/.codex/pstack-models.md` uses exactly one selection form:

- Fixed: `model` and `effort`, both non-empty strings. Use this form only for an explicit user choice.
- OCX: `source: ocx` and `fallback: {model, effort}`. Resolve it through the OpenCodex injection adapter; use the complete fallback when the adapter's checks fail.
- Adaptive: `source: adaptive`, `profile` naming an entry in pstack's `models.json` `codexRouting.profiles`. Classify the task on difficulty, failureCost and reasoningDepth, then resolve it with pstack's `route.mjs resolve`. Reject a failed resolution or unsupported pair before dispatch; adaptive does not silently substitute another model.

A role's form changes only on the user's explicit choice. Reject incomplete selections, mixed forms and invalid OCX fallbacks before dispatch. Validate every fixed pair, fallback and resolved pair against the active spawn contract. Record the source as `fixed`, `ocx`, `adaptive`, `fallback` or `user`. Use the child's final `turn_context` as the receipt of what ran.
<!-- /pstack-routing:1 -->
```

## Contradicting text

The block cannot share a policy with a rule that requires one form for everything. Before installing, find every line that does any of these:

- requires all defaults, roles or panel slots to use `source: ocx`;
- lists fixed and OCX as the only selection forms;
- rejects `source: adaptive` or forbids a per-role router.

The OCX injection adapter, delegation contract and fallback rules do not contradict the block and stay unchanged. In `~/.codex/pstack-models.md`, a preamble sentence saying every selection follows OpenCodex also contradicts it.

## Install rules

1. Marker present with the same version: no edit.
2. Marker present with another version: show the diff of the block only; edit on request.
3. No marker: locate the selection-forms passage (in the current legacy layout, the "All configured defaults, roles and panel slots use `source: ocx`" sentence through the Fixed and OCX bullets). Show a unified diff that replaces exactly that passage with the block. Apply it only on explicit request; every other byte of the file stays the same.
4. Anything else: if the passage cannot be identified, its text differs from the legacy layout, or a contradicting line remains outside it, stop. Show the proposed diff and quote the conflicting lines. Never append the block beside a contradicting rule.

Installing the block migrates no selection. Existing fixed and OCX selections keep their form until the user changes a role.
