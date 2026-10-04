---
name: correct
description: "Find the mistakes agents keep repeating in this repo and make each one impossible. Try architecture first, then types, then a lint whose error names the fix, then a test, and write docs last. Prove each check fails on a real past mistake. Use only when the user explicitly calls /correct; an ordinary correction in chat does not trigger it."
menu-description: turn mistakes agents repeat in this repo into checks that make them impossible
---

# Correct

Run this only when the user explicitly calls `/correct`. The operator keeps correcting agents in this repo for the same mistakes. Change the repo so the next agent can't make them.

Assume every contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Design the repo so a change that looks right from one file is right for the whole repo.

Stay inside this repo and the area the user named. Write rules to the repo's own agent instruction file, never to global memory, user config, or another repo. Fix only the mistake classes you found; leave unrelated cleanup for its own change.

## Find the mistake classes

First, read this repo's history for the area in scope: recent commits, reverts, review comments, agent instruction files, and comments that explain workarounds. Group the mistakes into classes. A class counts once it has happened at least twice. Cite each occurrence (commit, PR comment, or file and line).

## Fix each class at the highest level that works

1. **Eliminate it with structure.** Give each piece of state one owner and each task one supported way. Hide internals so the wrong import fails. Replace hand-synced lists with one source of truth. Delete the old ways and dead code of this class that an agent would copy.
2. **Enforce it with types so the bad state can't be written.**
3. **Add a lint or CI check whose error names the fix.** Use it when bad code still compiles. The error names the file, type, or function to use instead. If the pattern is already common, fail only when a change adds more.
4. **Test the behavior.** Fix or delete any test that would still pass if every function it calls returned nothing.
5. **Write docs or agent rules last, only for judgment calls.** Nothing fails when an agent skips them.

## Fix and prove

Fix the most frequent classes first, one class per commit. Prove each new check fails on a real past mistake: restore or replay that mistake, run the check, and record the failure before you record the pass. Run the same command locally and in CI. Exceptions go on the offending line with a reason, an expiry date, and a human's approval.

## Keep the rule table

Last, keep a table in the repo's agent instruction file that pairs each rule with what enforces it. On a later `/correct` run, a class whose rule is already in the table with nothing enforcing it is a repeat, so fix it at the highest level in that run. Drop a rule once its mistake can't happen.

**Reply:** each class with its evidence, the level you picked, why a higher level didn't work, and the failing run that proves the check catches the past mistake.
