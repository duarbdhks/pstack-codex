# Codex routing

Before each dispatch batch, read the user's global policy and `pstack-models.md`. The executable resolver computes one model and effort pair per configured slot. The parent passes its `spawn` object to the native tool and verifies the child's actual receipt. The resolver is not a runtime hook.

## Selection forms

| Form | YAML selection | Behavior |
| --- | --- | --- |
| Fixed | `{model, effort}` | preserve the exact pair |
| OCX | `{source: ocx, fallback: {model, effort}}` | use a valid OCX injection, otherwise the complete fallback |
| Adaptive | `{source: adaptive, profile}` | select a task tier from the named profile |

A complete pair explicitly requested by the user for the current task wins. An unsupported pair, mixed form, or incomplete selection is an error. Adaptive has no implicit fallback to OCX or another model. Only an OCX availability failure uses its configured fallback. Every OCX fallback is validated even when injection is healthy.

Adaptive requires both the compatible [policy block](codex-routing-policy.md) and `adaptiveAllowed: true` in the request. A marker mention or the block next to the known legacy OCX-only mandate does not enable it. Before enabling it, also check for other contradictory user rules. Existing role selections are never converted automatically. An existing sheet's missing role uses its evidence or judgment default; a missing required default is an error. An existing sheet can explicitly select adaptive defaults. The optional `defaults.implementation` supplies code tasks; when absent, legacy sheets retain their judgment default. An absent sheet uses catalog profiles only with adaptive authorization.

## Task classification

Use these axes for adaptive work:

| Axis | Tier 0 | Tier 1 | Tier 2 |
| --- | --- | --- | --- |
| `difficulty` | `routine`, one understood local change | `bounded`, several known steps | `complex`, design or unresolved interactions |
| `failureCost` | `low`, reversible isolated work | `medium`, recovery or integration work | `high`, expensive failure or shared effects |
| `reasoningDepth` | `shallow`, lookup or mechanical work | `standard`, trace and compare | `deep`, resolve competing constraints |

Choose the highest of the three levels. A routine task with high failure cost uses tier 2. The class describes the work; choosing a stronger model grants no additional permissions. Profiles and role mappings live in `models.json`. The table below is generated, not a second policy source.

## Dispatch profiles

Generated from `models.json`. These are capability and effort tiers, not measured prices. The active spawn contract validates each pair.

| Profile | Routine / low / shallow | Bounded / medium / standard | Complex / high / deep |
| --- | --- | --- | --- |
| evidence | `gpt-6-luna` / `medium` | `gpt-6-luna` / `high` | `gpt-6.1-sol` / `high` |
| implementation | `gpt-6.1-sol` / `medium` | `gpt-6.1-sol` / `high` | `gpt-6-astra` / `high` |
| judgment | `gpt-6.1-sol` / `high` | `gpt-6-astra` / `high` | `gpt-6-astra` / `xhigh` |

## Resolve and dispatch

Run with Bun, from the poteto-mode skill directory:

```shell
bun scripts/route.mjs resolve < request.json
bun scripts/route.mjs resolve --config /absolute/path/pstack-models.md --policy /absolute/path/AGENTS.md < request.json
```

`request.json` has this shape. Fill `contract` from the active spawn tool's exact supported IDs and efforts, not the app picker or the bundled catalog.

```json
{
  "contract": {"<supported exact model ID>": ["<supported effort>"]},
  "adaptiveAllowed": true,
  "entries": [{
    "role": "feature, refactoring",
    "task": {"difficulty": "routine", "failureCost": "low", "reasoningDepth": "shallow"},
    "message": "<complete task, constraints, and file pointers>"
  }]
}
```

Omit `adaptiveAllowed` for fixed and OCX-only batches. A task classification is required only for adaptive. An entry's optional `user: {model, effort}` is for a complete pair the user explicitly chose, never for silently bypassing policy. CLI input cannot override the loaded sheet with a `config` field. Resolve output records the sheet and policy paths, content hashes, and whether explicit paths were supplied; alternate paths are visible configuration overrides, not evidence of the user's default policy. Tests can supply a fixture sheet and policy by explicit paths; never rewrite the real user's configuration for a proof.

On success, record each returned role, slot, source, requested pair, task class, tier, and contract digest. Pass the returned `spawn` fields unchanged to the active spawn tool. Preview entries without `message` are not dispatchable; give each dispatched child its complete brief. Keep slot order and duplicates. Same-model slots provide independent contexts, not model diversity. A cross-judge candidate pool supplies choices, not parallel workers; when it contains several entries, give the request entry a zero-based `choice` and dispatch only that chosen slot.

The OCX adapter reads `ocx status --json` and `ocx agent status --json` at most once per batch, with 5-second command timeouts. A healthy local proxy and enabled injection guidance are required. Never mix the injection's model with the fallback's effort, change the proxy to repair a read failure, or retry an uncertain write on another model.

## Escalate

```shell
bun scripts/route.mjs escalate < escalation.json
```

Input contains `receipt` from resolve, the same `contract`, the prior child's `threadId` and optional exact `transcript`, `verifier: {failed: true, cause: "capability"}`, `sideEffects: "none"` or `"reverted"`, `previousWorkRecovered: true`, and `freshAttempt: true`. An optional `message` supplies the consolidated next brief.

Escalation is one tier, at most once, for adaptive selections only. It requires a verifier failure attributable to capability, a matching actual receipt read internally from the native transcript, intact task classification, recovered prior work, and a fresh bounded attempt. High failure cost, uncertain effects, transport errors, timeouts, missing context, a changed contract, and an exhausted profile stop it. A model's own claim of inability is not a verifier result.

## Receipts

```shell
bun scripts/route.mjs verify < verification.json
```

Input is `requested: {model, effort}` and `threadId` from the native spawn result. An optional exact `transcript` path avoids discovery. Its real path must be inside the Codex sessions root and its filename must identify this child. With only a UUIDv7 ID, the helper lists that date's session directory and the adjacent days, then reads only the matching file. It checks `session_meta.payload.id` and the final `turn_context.payload.model` and `.effort`. An incomplete file is inconclusive.

The output is `MATCH`, `MISMATCH` with the differing fields, or `INCONCLUSIVE` with the missing evidence. OCX can change a model after dispatch; the actual receipt, not the request or child summary, establishes what ran. Receipt matching establishes the recorded selection, not a completed inference or task correctness. An errored child can already have a turn context; check its completion and real output separately. Verify the task's real output separately.

The CLI exits 0 for success, 1 for resolution failure or mismatch, 2 for invalid usage/input, and 3 for an inconclusive receipt. `--help` describes the input contract.
