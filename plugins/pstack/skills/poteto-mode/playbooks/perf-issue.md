### Perf issue

**You own the measurement story. Plan, review, verify the numbers.** Tie every fix to a measurement, don't read source instead of measuring.

1. Capture a baseline trace via the driver skill (`run` for CLIs/TUIs, `verify` for UIs). Vet the baseline, and each later number, with the **benchmark-checklist** skill.
2. `how` to ground hypotheses; don't claim a perf ceiling without running it first.
   Try the performance mantras in order, cheapest first. A mantra earns an attempt only when the trace shows the signal it names.
   1. Don't do it. Stop work whose result nothing uses rather than cheapening it: a computation nobody consumes, a feature gate that's always off for this user, a sync that redundantly mirrors state, a legacy path kept "just in case". The trace shows what's slow, never that it's deletable, so this one needs the `how` pass, not the profiler.
   2. Do it, but don't do it again. The same computation or fetch repeats on identical inputs. Cache and reuse the result; name what invalidates it before claiming the win.
   3. Do it less. The dominant cost scales with input size or pays a fixed overhead per small operation. Prune, chunk, or index so each piece touches less, and batch calls (RPC, query, syscall, draw call) to pay the overhead once.
   4. Do it later. Cost lands on results not needed yet (eager init on the boot path, rendering offscreen items). Defer the work until first use.
   5. Do it when they're not looking. The work must happen, but not during the interactive moment. Move it to idle callbacks, a background warmup, precompute, or cleanup after the frame commits. The win is perceived latency, so measure the interactive path, not total work done.
   6. Do it concurrently. Independent pieces run in parallel, or a wait that hangs on one slow attempt gets a hedged duplicate. The trace has to show the wait dominates and the system has headroom.
   7. Do it cheaper. A faster algorithm, data structure, or implementation for work that must stay on the hot path.

   When an earlier mantra meets the target, stop.
3. Plan the fix from the trace. If it crosses a function boundary, `architect` first. Delegate implementation to a subagent using your configured perf-issue model (default in poteto-mode's Models section); review the diff. Capture a post-fix trace.
   Apply the **sequence-verifiable-units** principle skill, verifying each attempt before trying the next.
4. Parse and compare the artifacts (JSON to sqlite, diff). "Inconclusive" or wrong-surface is not a pass; flag it.
5. Cite one primary number in the PR, per **Opening a PR**. Put the run count, range, error and work counts, and limiter from the **benchmark-checklist** report in the linked artifact.
6. Run **Opening a PR**.

For sustained improvement against a metric rather than a one-off fix, use the Hillclimb playbook (`playbooks/hillclimb.md`).

**Reply:** baseline number, post-fix number, delta, run count and range, limiter, artifact path.
