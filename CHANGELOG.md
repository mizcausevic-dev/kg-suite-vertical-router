# Changelog

## [0.1.0] — 2026-05-29

### Added

- Initial release of the Kinetic Gain Protocol Suite vertical router.
- Detection logic (`src/detect.mjs`) for 6 artifact kinds: profile (3 variants: Decision Card / Incident Card / Evidence Bundle), Decision Card vault contract instance, Incident Card instance, Evidence Bundle manifest instance, audit-stream event, state-tracker event (incl. jurisdiction-form for HR Tech NYC LL 144).
- Routing logic (`src/route.mjs`) covering:
  - Profile / instance shape mapping (recognizes that `evidence-bundle-profile` (profile) defines instances of kind `evidence-bundle-manifest`)
  - Audit-stream kind-enum prefix routing (`fhir.*` → HealthTech, `student.*` → EdTech, `mortgage.*` → PropTech, `insurance.*` → InsurTech, `employment.*` → HR Tech, `fintech.*` → FinTech)
  - State-tracker agency-code heuristic routing with multi-vertical fallback (`routing_confidence: "none"` when agency spans multiple verticals e.g. CO-AG covers CO SB 24-205 across PropTech + FinTech + HR Tech + InsurTech)
- Verification logic (`src/verify.mjs`) covering structural checks + 4 cross-cutting invariants:
  - human-in-loop on adverse-action-capable audit events (all 4 verticals with this invariant: PropTech / InsurTech / HR Tech / FinTech)
  - FCRA permissible-purpose required when audit event references a credit-bureau resource type (FinTech-canonical but enforced cross-vertical anywhere it applies)
  - NYC Local Law 144 candidate-notice required when audit event has `agent.is_aedt_per_nyc_ll_144 = true` and external-candidate-facing kind (HR Tech)
  - Regulator-referral-evaluation structure check on Incident Cards (every pathway has `pathway` + `status` + `destination`; `evaluated-not-required` and `evaluated-not-applicable` should include `reason`)
- Router manifest (`manifest/profiles.json`) covering all 24 spec-side profile_id entries (Decision Card vault contracts, Incident Cards, Evidence Bundle profiles) across the 6 vertical 6-packs + 6 audit-stream kind-enum prefixes + 6 state-tracker source repos.
- CLI (`bin/kg-suite-route`) with human-readable + `--json` machine-readable output. Distinct exit codes (0 ok / 1 routing failed / 2 verification failed / 3 IO error).
- Programmatic API: `import { detect, route, verify, routeAndVerify, loadManifest } from "kg-suite-vertical-router"`.
- GitHub Action wrapper (`action.yml`).
- 10 canonical examples (one per vertical for audit-stream + one each for Decision Card / Incident Card / Evidence Bundle / state-tracker artifact kinds) drawn from the live canonical examples published in the 36 sibling spec repos.
- Test suite (`tests/router.test.mjs`) — pure-Node ESM, no external test-framework dependency, 10/10 examples pass.
- CI workflow.
- MIT license.

### Not yet

- Hash-chain re-verification on audit-stream NDJSON (the router checks structural + invariant integrity; full hash chain replay is delegated to the source repo's verifier — `kg-suite-route artifact.ndjson --deep` planned).
- Profile entries for all 6 audit-stream + 6 state-tracker repos (currently only the 24 Decision Card / Incident Card / Evidence Bundle profile_id entries are in the manifest; audit streams + state trackers are routed by kind-prefix and agency-code respectively).
- HealthTech + EdTech audit-stream invariant implementations beyond placeholders (the router currently routes them correctly but the human-clinician-required + FERPA school-official-exception invariants are not yet enforced in `verify.mjs`).
- Optional Rust + Go implementations of the router.
