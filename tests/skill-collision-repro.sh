#!/usr/bin/env bash
# Regression checks for the pstack plugin layout (CHANGES 0.9.7-0.9.13).
#
# Claude Code renders a plugin's commands AND its user-invocable skills in the
# slash menu, so a command trampoline paired with a same-named skill shows the
# entry twice (#22). 0.9.13 moved the trampolines to .codex-plugin/prompts/,
# where only the Codex symlink path reads them. The invariant here keeps a
# future upstream sync from reintroducing plugins/pstack/commands/.
#
# This also enforces the static maintenance invariants from CHANGES.md: the
# principle-* leaf flags. (Version parity, the model quad, and prompt<->skill
# correspondence are no longer checked here: tools/generate.mjs stamps each
# from its source file and CI regenerates and diffs, so none can drift on a
# green build.)
#
# Each static check is a function that prints one finding per line; empty
# output is a pass. `check` names it in the report. tests/invariants.test.mjs
# runs this script against fixture trees (via PSTACK_REPO) to prove every
# check still fails when it should.
set -euo pipefail

repo="${PSTACK_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
fail=0

note() { printf '%s\n' "$*"; }
frontmatter_of() { sed -n '2,/^---$/p' "$1"; }

# check <name> <fn>: run fn, report ok/FAIL under name, indent its findings.
check() {
  local name="$1" fn="$2" out
  out="$("$fn")"
  if [ -n "$out" ]; then
    note "FAIL: $name"
    printf '%s\n' "$out" | sed 's/^/  /'
    fail=1
  else
    note "ok: $name"
  fi
}

# (0.9.13, #22): the Claude Code plugin ships no commands/. Every /pstack:<name>
# is served by the skill itself; a commands/ directory reappearing (typically
# via an upstream sync) duplicates every slash-menu row.
no_commands_dir() {
  [ -e "$repo/plugins/pstack/commands" ] &&
    echo "plugins/pstack/commands/ exists; trampolines belong in .codex-plugin/prompts/ (see CHANGES 0.9.13)"
  return 0
}

# (CHANGES 0.9.8): no skill may carry disable-model-invocation. On a skill the
# flag makes the Skill tool refuse the invocation outright, which breaks the
# SessionStart mandate and model-initiated entry. Frontmatter only: skill
# bodies may mention the flag in prose (automate-me does).
no_disable_model_invocation() {
  local skill
  for skill in "$repo"/plugins/pstack/skills/*/SKILL.md; do
    frontmatter_of "$skill" | grep -q '^disable-model-invocation: true$' && echo "$skill"
  done
  return 0
}

# (CHANGES 0.9.9): every command-less principle-* leaf carries
# user-invocable: false (hidden from the / menu, read by path from poteto-mode)
# and NOT disable-model-invocation (the pair cancels to a dead skill).
principle_leaves_hidden() {
  local skill front
  for skill in "$repo"/plugins/pstack/skills/principle-*/SKILL.md; do
    [ -f "$skill" ] || continue
    front="$(frontmatter_of "$skill")"
    printf '%s\n' "$front" | grep -q '^user-invocable: false$' || echo "$skill (missing user-invocable: false)"
    printf '%s\n' "$front" | grep -q '^disable-model-invocation: true$' && echo "$skill (still carries disable-model-invocation)"
  done
  return 0
}

codex_dispatch_uses_default_agent() {
  local mapping violations
  mapping="$repo/plugins/pstack/skills/poteto-mode/references/codex-tools.md"
  if [ ! -f "$mapping" ]; then
    echo "$mapping (missing)"
    return 0
  fi

  violations="$(bun -e '
    const text = await Bun.file(process.argv[1]).text();
    const match = text.match(/^## Codex spawn contract\n\n```json\n([\s\S]*?)\n```$/m);
    if (!match) {
      console.log("missing Codex spawn contract");
      process.exit(0);
    }
    let contract;
    try {
      contract = JSON.parse(match[1]);
    } catch {
      console.log("Codex spawn contract must be valid JSON");
      process.exit(0);
    }
    const expected = {
      agent_type: ["default", "agent_type must be default"],
      task_name: ["<semantic role>", "task_name must carry the semantic role"],
      model: ["<configured model>", "model must be explicit"],
      reasoning_effort: ["<configured effort>", "reasoning_effort must be explicit"],
      fork_turns: ["none", "fork_turns must be explicit"],
    };
    for (const [field, [value, message]] of Object.entries(expected)) {
      if (contract[field] !== value) console.log(message);
    }
  ' "$mapping")"
  [ -z "$violations" ] ||
    printf '%s\n' "$violations" |
      while IFS= read -r violation; do
        printf '%s (%s)\n' "$mapping" "$violation"
      done
  return 0
}

# comment-sicko is a child prompt, not the no-comments orchestrator. Mapping
# that child at no-comments/SKILL.md makes the child spawn itself.
comment_sicko_prompt_not_orchestrator() {
  local mapping="$repo/plugins/pstack/skills/poteto-mode/references/codex-tools.md"
  [ -f "$mapping" ] || return 0
  if grep -q 'comment-sicko' "$mapping"; then
    if grep 'comment-sicko' "$mapping" | grep -q 'no-comments/SKILL.md'; then
      echo "$mapping (comment-sicko prompt must not be no-comments/SKILL.md)"
    fi
    local prompt="$repo/plugins/pstack/skills/no-comments/references/comment-sicko.md"
    [ -f "$prompt" ] || echo "$prompt (missing)"
  fi
  return 0
}

check "no plugins/pstack/commands/ directory" no_commands_dir
check "no skill carries disable-model-invocation: true" no_disable_model_invocation
check "principle-* leaves carry user-invocable: false and not disable-model-invocation" principle_leaves_hidden
check "Codex pstack dispatch uses the default agent with explicit policy" codex_dispatch_uses_default_agent
check "comment-sicko prompt is not no-comments/SKILL.md" comment_sicko_prompt_not_orchestrator

exit "$fail"
