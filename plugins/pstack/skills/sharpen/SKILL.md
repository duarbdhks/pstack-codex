---
name: sharpen
description: "Make a task deeper, not bigger, then rewrite the prompt. Use for /sharpen."
---

I want a deeper version of this task, not a bigger one. Before rewriting it, do four things:

1. Say what a top professional in this field would do here that I'm not asking for.
2. Name the rawest material they would start from instead of what has already been digested for me.
3. Name the specific methods and tools they would use.
4. Say what, other than you or me, would show the result is right.

Then rewrite my prompt to ask for exactly that.

Leave choices that are mine to make open instead of deciding them.

## Codex runtime

On Codex, upstream tool, path, and agent names in this skill map through [codex-tools.md](../poteto-mode/references/codex-tools.md). A `<role model>` placeholder is the role's model resolved by [Codex routing](../poteto-mode/references/codex-routing.md). Where a step here says to omit `model`, run on the parent model, or fall back to another slug after a rejection, the Codex spawn contract wins: resolve the pair or stop before spawning.
