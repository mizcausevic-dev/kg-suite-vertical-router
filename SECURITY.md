# Security Policy

`kg-suite-vertical-router` reads Suite-artifact JSON files (Decision
Card vault contracts, Incident Cards, Evidence Bundle manifests,
audit-stream events, state-tracker events) from local disk, parses
them with `JSON.parse` (no `eval`, no `Function()`), runs structural +
cross-cutting-invariant checks in-process, and writes a unified
pass/fail report. No network calls. No user-supplied code execution.

When run as a GitHub Action, the workflow uses `${{ github.token }}` by
default — scoped to the repository where the workflow runs and never
persisted. If you provide your own token, ensure it has only the
`contents: read` permission needed to read repo files.

## Supported versions

Only the latest tagged release is supported.

## Reporting a vulnerability

Please use GitHub Security Advisories for private disclosure:

- [Open a security advisory](https://github.com/mizcausevic-dev/kg-suite-vertical-router/security/advisories/new)

Do not file public issues for security reports. The Kinetic Gain
organization commits to acknowledging within 72 hours per the apex
coordinated-disclosure policy at
<https://kineticgain.com/.well-known/security.txt>.

## Cryptographic invariants this router preserves

If you find a way to violate any of these, that is a security issue:

1. **Spec-shape vs ref-impl-shape parity** — both audit-stream shapes
   verify against the same canonical-JSON algorithm. Any divergence
   that lets two distinct events hash to the same value is a bug.
2. **Vertical attribution honesty** — the report's `vertical` field
   MUST reflect the labels/enum/regulator-code that drove the routing
   decision. Reporting "HealthTech" for an event the router actually
   classified as "FinTech" is a bug regardless of which is "more
   correct."
3. **Invariant checklist completeness** — if the report says
   `human_in_loop: passed`, the router MUST have actually checked
   that invariant against the artifact. Silent skips count as bugs.

## What this router does NOT do

- It does not verify ed25519 signatures on the artifacts (that's the
  embedding caller's job; see the broader Suite signature convention
  at <https://kineticgain.com/trust/signing-policy/>).
- It does not enforce field-level redaction (that's
  `kinetic-gain-embedded`'s `applyVaultContract`).
- It does not make compliance claims. The report is a structural
  signal, not an attestation.
