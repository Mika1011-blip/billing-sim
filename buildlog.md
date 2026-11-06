# Build log

Every change to this repo gets an entry here: date, branch, what changed, how it was verified.

| Date | Branch | Change | Verification |
|---|---|---|---|
| 2026-11-06 | main | Repo cloned; design spec written at `docs/superpowers/specs/2026-11-06-billing-sim-design.md`; this log created | Spec reviewed section by section in conversation; no code yet |
| 2026-11-06 | main | Implementation plan written at `docs/superpowers/plans/2026-11-06-billing-sim.md` (11 tasks, worktree/merge/test cadence); API key accepted as `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` | Plan self-reviewed against the spec; awaiting owner review |
| 2026-11-06 | develop | Created integration branch develop from main | n/a |
| 2026-11-06 | task/01-billing | Scaffold backend package (pyproject, billing_sim), `billing/policy.py` (ticket fee, lot price, VAT half-up, due day), `contract_template.json`, `scripts/test.sh`; `.superpowers/` gitignored | `bash scripts/test.sh` -> 8 passed, exit 0 |
| 2026-11-06 | develop | Merged task/01-billing: billing policy, contract template, test runner | bash scripts/test.sh green on develop |
| 2026-11-06 | main | Merged develop (task/01-billing): billing policy, contract template, test runner | bash scripts/test.sh green on main |
| 2026-11-06 | task/02-scenario | Scenario schema (`scenario/schema.py`), plan validator (`validate.py`: duplicate keys, lots, dependencies, cycles via Kahn, client behaviour, blocked beats) and French `invoice_dashboard` fallback fixture | `bash scripts/test.sh` -> 22 passed, exit 0 |
| 2026-11-06 | develop | Merged task/02-scenario: scenario schema, validation, fallback fixture | bash scripts/test.sh green on develop |
