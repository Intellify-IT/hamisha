# Sprint plan

## Sprint 1 (13–16 Nov 2026) — v1.0 sweep, v1.1 verified clean-up
Goal: every file under the configured root that the old account owns is copied to the new owner, checked, and its original trashed, with a full log, by Mon 16 Nov.

| # | Item | Done when |
|---|---|---|
| 1 | Sweep: copy, twin folders, mark originals, log, digest | tests pass ✅ |
| 2 | Resume across the 6-minute cap without re-walking finished folders | test passes ✅ |
| 3 | Clean-up role: verify each copy, then trash the original; empty folders after | 12 tests pass ✅ |
| 4 | Deploy both roles; first full sweep | log reviewed ✅ |
| 5 | First clean-up after the grace period | log shows trashed / kept with reasons |
| 6 | Public repo, CI green | Actions run passes |
