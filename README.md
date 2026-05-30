# kg-suite-vertical-router

> **Kinetic Gain Protocol Suite Vertical Router v0.1.** A single npm package + GitHub Action that auto-detects + routes any Suite artifact — Decision Card vault contract, Incident Card, Evidence Bundle manifest, audit-stream event, or state-tracker lifecycle event — to the right vertical-specific verification logic across all six vertical 6-packs (36 spec repos). Makes the Suite's parallel-structure thesis provably code-true at runtime, not just rhetorically consistent across READMEs.

[![CI](https://github.com/mizcausevic-dev/kg-suite-vertical-router/actions/workflows/ci.yml/badge.svg)](https://github.com/mizcausevic-dev/kg-suite-vertical-router/actions/workflows/ci.yml)

Part of the [Kinetic Gain Protocol Suite](https://suite.kineticgain.com).

## What it does

Given any Suite artifact, the router:

1. **Detects** the artifact kind (Decision Card vault contract / Incident Card / Evidence Bundle manifest / Evidence Bundle profile / audit-stream event / state-tracker event)
2. **Identifies** the vertical via `labels.profile`, audit-stream `kind` enum prefix, or `regulator.primary_agency_code` heuristics
3. **Verifies** structural integrity (required fields) + cross-cutting invariants (human-in-loop, FCRA permissible-purpose, NYC LL 144 candidate-notice)
4. **Returns** a unified pass/fail report with vertical attribution, source-repo link, and invariant checklist

## Why this matters

The Suite ships six parallel vertical 6-packs (36 sibling spec repos):

| Vertical | Federal floor |
| --- | --- |
| **HealthTech** | FDA SaMD · HIPAA · Section 1557 |
| **EdTech** | FERPA · COPPA · IDEA / Section 504 · ESSA |
| **PropTech / Real Estate** | RESPA · ECOA Reg B · Fair Housing · HMDA · GLBA |
| **InsurTech** | NAIC AI Model Bulletin (Nov 2023) · NY DFS CL 7 · CO SB 21-169 |
| **HR Tech / Employment AI** | EEOC AI Guidance (May 2023) · Title VII · ADA · ADEA · GINA · NYC LL 144 |
| **FinTech** | CFPB · OCC / FRB / FDIC joint AI · ECOA Reg B · FCRA Reg V · GLBA · BSA/AML |

Each vertical's six repos mirror the same six shapes (Decision Card vault · Incident Card · Evidence Bundle compliance · Evidence Bundle bias · Operator audit-stream · Operator regulatory-lifecycle tracker). The router proves that parallelism is real: **one tool with one CLI command routes + verifies any artifact across any vertical**.

## Quick start

```bash
npm install -g kg-suite-vertical-router

# Route + verify a single artifact JSON
kg-suite-route path/to/decision-card.json

# Route + verify each line of an NDJSON audit-stream
kg-suite-route path/to/audit-stream.ndjson

# Machine-readable output
kg-suite-route path/to/artifact.json --json
```

Or as a GitHub Action:

```yaml
- uses: mizcausevic-dev/kg-suite-vertical-router@v0.1
  with:
    artifact-path: artifacts/coastguard-q4-decision-card.json
```

## Example output

Routing the canonical FinTech audit-stream event:

```text
event 1/1:
✓ vertical=FinTech  artifact_kind=audit-stream-event
  event_kind: fintech.consumer-credit.application-read
  source_repo: mizcausevic-dev/financial-decision-record-audit-stream
  invariants_checked: human-credit-officer-required-on-adverse-action-capable, fcra-permissible-purpose-required-on-credit-bureau-resource
```

Routing an evidence bundle manifest:

```text
✓ vertical=FinTech  artifact_kind=evidence-bundle-manifest
  profile_id: cfpb-readiness-v0.1
  bundle_id: meridian-cfpb-2026q4
  source_repo: mizcausevic-dev/cfpb-readiness-evidence-bundle
  anchor_regulations: CFPB AI bulletin, OCC 2011-12, FRB SR 11-7, ECOA Reg B, FCRA Reg V, GLBA Safeguards, BSA/AML, Section 1071, Section 1033, CFPB UDAAP
```

## Exit codes

| Code | Meaning |
| --- | --- |
| **0** | Routed + verified, no errors |
| **1** | Routing failed (unrecognized profile / kind prefix / artifact shape) |
| **2** | Verification failed (structural or invariant errors) |
| **3** | Usage / IO error |

CI gates and pre-commit hooks can branch on these codes.

## How routing works

### For audit-stream events
Routed by the `kind` enum prefix (`fhir.*` → HealthTech, `student.*` → EdTech, `mortgage.*` → PropTech, `insurance.*` → InsurTech, `employment.*` → HR Tech, `fintech.*` → FinTech). Then vertical-specific invariants run:

- **`fhir.*`**: human-clinician-required + FHIR permissible-purpose
- **`student.*`**: FERPA school-official-or-consent-basis required
- **`mortgage.*`**: human-underwriter-required on adverse-action
- **`insurance.*`**: human-adjudicator-required on adverse-action-capable recommendation
- **`employment.*`**: human-hiring-decision-required + NYC LL 144 candidate-notice (when AEDT)
- **`fintech.*`**: human-credit-officer-required + FCRA permissible-purpose (when credit-bureau resource)

### For Decision Card / Incident Card / Evidence Bundle instances
Routed by the `profile_id` reference (looked up in `manifest/profiles.json`). The manifest maps each of the 36 sibling spec repos to a (vertical, artifact_kind, source_repo, anchor_regulations) tuple.

### For state-tracker events
Routed by `regulator.primary_agency_code` (e.g. `NY-DFS` → FinTech, `CO-DOI` → InsurTech, `NYC-DCWP` → HR Tech). Multi-vertical agencies (e.g. `CO-AG` for CO SB 24-205, which spans PropTech + FinTech + HR Tech + InsurTech) route with `routing_confidence: "none"` and emit a warning prompting `--vertical=...` override.

## Programmatic API

```js
import { routeAndVerify } from "kg-suite-vertical-router";
import { readFileSync } from "node:fs";

const artifact = JSON.parse(readFileSync("./my-decision-card.json", "utf8"));
const result = routeAndVerify(artifact);

console.log(result.routing.vertical);         // "FinTech"
console.log(result.routing.artifact_kind);    // "decision-card-vault-contract"
console.log(result.routing.source_repo);      // "mizcausevic-dev/financial-customer-data-vault-contract-profile"
console.log(result.verification.ok);          // true | false
console.log(result.verification.errors);      // []
console.log(result.verification.warnings);    // []
```

## Adding a new profile to the manifest

When a new spec repo lands (e.g. a 7th vertical's audit stream), add an entry to `manifest/profiles.json`:

```json
"profiles": {
  "govtech-decision-record-audit-stream-v0.1": {
    "vertical": "GovTech / Public Sector AI",
    "artifact_kind": "audit-stream-event",
    "source_repo": "mizcausevic-dev/govtech-decision-record-audit-stream",
    "anchor_regulations": ["OMB M-24-10", "AI Bill of Rights", "Section 508"]
  }
}
```

For audit-stream events, also add the kind-enum prefix:

```json
"audit_stream_kind_prefixes": {
  "govtech.": {
    "vertical": "GovTech / Public Sector AI",
    "source_repo": "mizcausevic-dev/govtech-decision-record-audit-stream",
    "invariants": ["human-government-officer-required-on-consequential-decision"]
  }
}
```

PRs welcome.

## Composes with

| Repo | Role |
| --- | --- |
| All 36 sibling spec repos across the 6 vertical 6-packs | Routed targets |
| [`evidence-bundle-spec`](https://github.com/mizcausevic-dev/evidence-bundle-spec) | Underlying Evidence Bundle conventions |
| [`decision-card-spec`](https://github.com/mizcausevic-dev/decision-card-spec) | Underlying Decision Card conventions |
| [`kg-suite-conformance-runner`](https://github.com/mizcausevic-dev/kg-suite-conformance-runner) | Deeper conformance runner for individual specs (per-repo) |

## Compliance posture

Suite-readiness scaffolding for cross-vertical Decision Card / Incident Card / Evidence Bundle / audit-stream / state-tracker artifact routing. Supports a buyer's program toward consistent Suite-artifact handling across mixed-vertical AI vendor portfolios but does not by itself establish compliance with any underlying statute or rule. The router does NOT re-run the source-repo's full schema verifier — it does routing + cross-cutting invariant-level checks that prove an artifact belongs to its claimed vertical and obeys the canonical six-shape Suite contract. Per the standing public-language guardrail: *readiness · evidence · posture · controls · scaffolding* — never "Suite-compliant" or "cross-vertical-attested" without an external attestation specific to each underlying regulatory regime.

## License

MIT — see [`LICENSE`](./LICENSE).
