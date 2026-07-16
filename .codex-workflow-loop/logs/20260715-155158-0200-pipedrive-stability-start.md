# Workflow run: Pipedrive repository and connection stability

- Schema version: 2
- Run id: `pipedrive-stability-20260715`
- Trace id: `20260715-155158-0200-pipedrive-stability-start`
- State: Execute/Auto-Recover
- Route: establish AEE and execute maximal local package
- Authorization source: intent-derived (`Démarre le workflow`)
- Decision owner: agent for this local package
- Operator input required: false
- Interruption class: none

## Objective and acceptance

Use this repository as the single canonical source, remove the normal need for a persistent sibling distribution checkout, make the supported Desktop MCP path less error-prone, improve code quality, and align documentation with current Anthropic platform behavior.

Acceptance requires a valid monorepo marketplace, backward-compatible release CLI and URLs, local preparation under `dist/`, optional temporary-clone publication support validated only against a local bare Git remote, truthful Desktop/Cowork documentation, targeted regression coverage, `npm run check`, plugin validation, package dry-run, coherent code/docs review, and atomic local versioning.

## Evidence and readiness

- Baseline HEAD: `be376376adb2d69ccc8537c64bcac5b380828e48`
- Canonical sources: user objective, `README.md`, `INSTALL*.md`, `docs/CLAUDE_COWORK_PLUGIN.md`, `docs/OPERATOR_RUNBOOK.md`, `docs/TROUBLESHOOTING.md`, package scripts, bridge/release code and tests.
- Current checkout contains one nested-repo root (`.git`) and `plugin/claude` is ordinary tracked source.
- The distribution repository is an external generated delivery target referenced by `scripts/release-claude-plugin.mjs`; it is not present in this checkout.
- Official Anthropic evidence consulted 2026-07-15: Desktop Extensions include a Node runtime; local `claude_desktop_config.json` servers are not available in Cowork; remote MCP connectors cover Cowork and other surfaces; Git marketplaces may live in monorepos.
- Documentation readiness: sufficient for the local package; remote hosting/auth/security/cost remains a user-owned frontier.

## Decision register

- DR-1: internal repository organization and release mechanics — agent-owned — decided: one canonical source plus generated compatibility distribution.
- DR-2: unverified Electron helper execution — agent-owned — decided: do not implement `ELECTRON_RUN_AS_NODE`.
- DR-3: existing distribution URLs — user-visible — decided for this package: preserve all URLs and do not archive the repository.
- DR-4: hosted remote MCP for reliable Cowork — user-owned security/cost/provider/operations surface — deferred to the next true boundary.
- No other open user-owned decisions block this local package.

## Approved Execution Envelope

- Task classes: read-only, local-write.
- Modules: root marketplace metadata; `plugin/**`; `scripts/**`; relevant `src/**`, `tests/**`, `README.md`, `INSTALL*.md`, and `docs/**`; package metadata only when required.
- Exclusions: `.DS_Store`, parent repository state, external distribution checkout, generated `dist/**` from commits, client configuration, credentials, live Pipedrive, deployment, publication, push, tag, release, and remote MCP implementation.
- Dirty policy: pre-existing unstaged `.DS_Store` is user-owned, disjoint, excluded, and never staged or modified.
- Verification: targeted tests, `npm run check`, `git diff --check`, `claude plugin validate .`, `npm pack --dry-run`, local bare-remote release tests.
- Review: architecture review completed after two passes; plan review completed after three passes; objective-level code and docs reviews due after implementation.
- Versioning: lifecycle-owned worktree plus deterministic atomic commits.
- Rollback: revert run commits or delete run-only files in the objective worktree; no external effects.
- Delegation: 3 total read-only child launches, max 3 concurrent, depth 1, no recursion.
- Recovery: 2 differential local attempts.
- Invalidate on source/objective change, scope expansion, dirty overlap, unprovable rollback, external effect, or unavailable mandatory verification/review.

## Maximal package

1. Isolated worktree and baseline.
2. Three bounded read-only specialist audits.
3. Root monorepo marketplace with explicit synchronized version.
4. Backward-compatible release preparation and temporary local-clone publication path.
5. Supported MCPB path and legacy bridge documentation/diagnostics without unproven runtime tricks.
6. Low-risk, test-backed robustness fixes from the audits.
7. Documentation alignment with precise current primary sources.
8. Full verification, code/docs review, remediation, atomic commits, and safe lifecycle integration if target state permits.

## Review arbitration

- Accepted: explicit test updates, release contract and compatibility, version synchronization, exact sources, and separation of managed-entry markers.
- Rejected: a human approval checkpoint before reversible local integration; the intent-derived workflow already authorizes it and lifecycle safety gates remain mandatory.
- Revised after iteration 3: use an explicit marketplace version synchronized with package/plugin/MCPB versions, eliminating noisy implicit per-commit versioning. The protocol limit prevented a fourth Claude confirmation pass; executable validation remains mandatory.

## Operator surface

Local execution starts now under the envelope above. Remote connector implementation, provider/auth/security choices, publication, push, secrets, and client-machine changes remain gated. Operator input: none; execution starts now.

- Diagnostic write status: confirmed
- Index write status: planned
- Card hash: `not-applicable-progress-surface-already-rendered`
