# Changelog

## [0.2.0] — 2026-05-31

### Added — catch up to 10 verticals × 60 specs + 10 AGPL ref impls

- **4 new verticals** in `manifest/profiles.json`: **GovTech** (OMB M-24-10 + Privacy Act + AI Bill of Rights + FedRAMP), **LegalTech** (ABA Model Rules 1.1c8/1.6/3.3/5.3/5.5 + attorney-client privilege + work-product doctrine), **EnergyTech** (NERC CIP-002–014 + TSA SD-2021-02C + FERC Order 2222), **DefenseTech** (DFARS 7012/7019/7020/7021 + CMMC 2.0 L2/L3 + NIST SP 800-171/172 + ITAR + EAR + NISPOM). Manifest now lists 16 new profile entries (4 verticals × 4 specs/vertical mapped), 4 new state-tracker repos, and 8 new audit-stream kind prefixes (`matter.`, `legaltech.`, `grid.`, `energytech.`, `defense.`, `defensetech.`, `government.`, `govtech.`).
- **Reference-implementation prefix aliases** for all 10 verticals — every ref impl's kind prefix routes to its vertical: `proptech.`, `insurtech.`, `edtech.`, `hrtech.`, `healthtech.`, `legaltech.`, `energytech.`, `defensetech.`, `govtech.` (+ existing `fintech.`). The manifest distinguishes spec-side prefixes from `"shape": "ref-impl"` aliases so consumers know which schema variant to expect.
- **Top-level `reference_implementations` block** in the manifest — explicit mapping from each ref-impl repo name to its (vertical, ref-impl kind prefix, invariants) so the router can answer "for a given vertical, which ref impl proves the spec invariants?"
- **Dual-shape audit-stream verifier** (`src/verify.mjs`): detects shape via `Array.isArray(regulatory_basis)` and dispatches. Ref-impl shape adds invariants matching the new ref impls: **PropTech UNIVERSAL** human-underwriter (fires on adverse-action-capable kind regardless of recommendation) + **ECOA 30-day** notice anchored on `application_completed_at`; **InsurTech SCOPED** human-adjudicator + **NAIC 90-day backward-bounded** bias-monitoring window with AFTER-event timestamp check; **EdTech FERPA basis enumeration** (8-entry set from 34 CFR Part 99) + **COPPA must-precede-event** consent for `student_age < 13`.
- **Extended agency-code routing** in `src/route.mjs`: NERC / FERC / TSA-PIPELINE / *-PUC / DOE-OE / DOE-CESER (EnergyTech), DoD / DCSA / DCMA / DLA / CISA / USCYBERCOM / STATE-DDTC (DefenseTech), OMB / GSA / OPM (GovTech), ABA / *-BAR / USDC-* / USCA-* (LegalTech), NAIC (InsurTech), CFPB (FinTech). `ALLOWED_VERTICALS` now lists all 10.
- **10 new example files**, one per vertical — real NDJSON streams emitted by each ref impl (copied verbatim from each ref impl's `examples/*.ndjson`): `{healthtech,legaltech,energytech,defensetech,govtech,fintech,hrtech,edtech,proptech,insurtech}-refimpl-event.ndjson`. These exercise the ref-impl shape end-to-end through the router.
- **`npm run demo:refimpl`** + **`npm run demo:all`** scripts — one-shot routing demo across all 10 ref impls.
- **Test coverage extended to 20 examples** (10 spec-shape + 10 ref-impl-shape + 4 non-audit-stream). All 20 green.
- **README/manifest description bumped** from "6 vertical 6-packs (36 spec repos)" to "10 vertical 6-packs (60 spec repos) AND their 10 AGPL-3.0 reference implementations."

### Changed

- `regulatory_basis` field downgraded from hard-required to warning-level for spec-shape events. Older ref impls (notably HealthTech's `fhir-resource-access-audit-reference`) pre-date the convention. Router-level stays permissive; the source repo's own verifier enforces full schema requirements.

### Backwards compatibility

- All 10 pre-existing example files (spec-shape audit-stream + Decision Card / Incident Card / Evidence Bundle / state-tracker) continue to route and verify identically. v0.1 router API unchanged.

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
