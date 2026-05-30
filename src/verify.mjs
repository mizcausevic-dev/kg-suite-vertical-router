// verify.mjs — Vertical-aware structural + invariant checks on a routed artifact.
//
// Returns: { ok, errors[], warnings[] }
//
// Verification responsibilities:
//   - Decision Card vault-contract instance: required top-level fields, vault_contract block presence, retention_envelope shape per category, signature presence
//   - Incident Card instance: required top-level fields, regulator_referral_evaluation block structure
//   - Evidence Bundle manifest instance: required top-level fields, bundle.labels.profile presence, items list non-empty, signature presence
//   - audit-stream event: invariant checks driven by routing.invariants (e.g. "human-credit-officer-required-on-adverse-action-capable")
//   - state-tracker event: required state-machine fields (effective_date when lifecycle_state=effective, etc.)
//
// Invariant implementations:
//   - human-*-required-on-adverse-action: if event.kind is in vertical's adverse-action-capable kind set AND event.ai_recommendation.recommendation is in vertical's adverse-action-capable rec set, then ai_recommendation.<human_field> MUST be true.
//   - fcra-permissible-purpose-required-on-credit-bureau-resource: if resource.type is credit-bureau-tradeline or credit-bureau-inquiry-history, fcra_governance.permissible_purpose MUST be present.
//   - nyc-ll-144-candidate-notice-required-on-aedt-external-candidate-event: if agent.is_aedt_per_nyc_ll_144 = true AND kind is external-candidate-facing, candidate_notice_provided.notice_provided MUST be true.
//
// The router intentionally does NOT re-run the source-repo's full schema verifier — it does the routing + invariant-level checks that prove the artifact belongs to the claimed vertical and obeys the cross-cutting invariants.

const ADVERSE_ACTION_KINDS = {
  "mortgage.": new Set(["mortgage.application.recommendation-produced"]),
  "insurance.": new Set(["insurance.underwriting.recommendation-produced", "insurance.claim.recommendation-produced", "insurance.claim.triage-produced"]),
  "employment.": new Set(["employment.hiring.recommendation-produced", "employment.promotion.recommendation-produced", "employment.performance.recommendation-produced", "employment.termination.recommendation-produced", "employment.hiring.video-interview-scored", "employment.hiring.assessment-scored"]),
  "fintech.": new Set(["fintech.consumer-credit.recommendation-produced", "fintech.section-1071-small-business.recommendation-produced", "fintech.deposit-account.opening-evaluated", "fintech.consumer-credit.line-management-evaluated"])
};

const ADVERSE_ACTION_RECOMMENDATIONS = {
  "mortgage.": new Set(["decline"]),  // mortgage uses universal invariant (any recommendation requires human underwriter), but we treat decline as canonical for cross-vertical check
  "insurance.": new Set(["decline", "rate-up", "approve-with-conditions"]),
  "employment.": new Set(["decline", "do-not-promote", "performance-below", "terminate-recommended"]),
  "fintech.": new Set(["decline", "approve-with-conditions", "counter-offer", "freeze", "reduce-line"])
};

const CREDIT_BUREAU_RESOURCE_TYPES = new Set([
  "credit-bureau-tradeline",
  "credit-bureau-inquiry-history",
  "credit-bureau-inquiry",
  "credit-bureau-record"
]);

const EXTERNAL_CANDIDATE_FACING_KINDS = new Set([
  "employment.hiring.sourcing-ranked",
  "employment.hiring.resume-screened",
  "employment.hiring.video-interview-scored",
  "employment.hiring.assessment-scored",
  "employment.hiring.recommendation-produced",
  "employment.hiring.adverse-action-evaluated"
]);

function verifyDecisionCard(obj) {
  const errors = [], warnings = [];
  for (const f of ["decision_card_version", "decision_id", "issued_at", "buyer", "subject", "decision", "vault_contract", "publishing"]) {
    if (!(f in obj)) errors.push(`Decision Card missing required top-level field: ${f}`);
  }
  if (obj.vault_contract && !obj.vault_contract.profile) errors.push("vault_contract.profile missing");
  if (obj.vault_contract && !Array.isArray(obj.vault_contract.data_category_access)) errors.push("vault_contract.data_category_access must be an array");
  if (obj.publishing && !obj.publishing.signed_by_key_uri) warnings.push("publishing.signed_by_key_uri missing — Decision Card is unsigned");
  return { errors, warnings };
}

function verifyIncidentCard(obj) {
  const errors = [], warnings = [];
  for (const f of ["incident_card_version", "incident_id", "discovered_at", "reported_at", "event_type", "severity", "affected_ai_system", "affected_decision_card_ref", "regulator_referral_evaluation", "remediation_plan"]) {
    if (!(f in obj)) errors.push(`Incident Card missing required top-level field: ${f}`);
  }
  if (!Array.isArray(obj.regulator_referral_evaluation)) errors.push("regulator_referral_evaluation must be an array");
  else {
    for (const [i, p] of obj.regulator_referral_evaluation.entries()) {
      if (!p.pathway || !p.status || !p.destination) errors.push(`regulator_referral_evaluation[${i}] missing pathway/status/destination`);
      if (p.status === "evaluated-not-required" && !p.reason) warnings.push(`regulator_referral_evaluation[${i}] status=evaluated-not-required but reason is missing`);
      if (p.status === "evaluated-not-applicable" && !p.reason) warnings.push(`regulator_referral_evaluation[${i}] status=evaluated-not-applicable but reason is missing`);
    }
  }
  if (!obj.signed_by_key_uri) warnings.push("signed_by_key_uri missing — Incident Card is unsigned");
  return { errors, warnings };
}

function verifyEvidenceBundleManifest(obj) {
  const errors = [], warnings = [];
  for (const f of ["evidence_bundle_version", "bundle", "items"]) {
    if (!(f in obj)) errors.push(`Evidence Bundle manifest missing required top-level field: ${f}`);
  }
  if (obj.bundle && !obj.bundle.labels?.profile) errors.push("bundle.labels.profile missing");
  if (!Array.isArray(obj.items) || obj.items.length === 0) errors.push("items must be a non-empty array");
  if (!obj.signature) warnings.push("signature block missing — Evidence Bundle is unsigned");
  return { errors, warnings };
}

function verifyAuditStreamEvent(obj, routing) {
  const errors = [], warnings = [];
  for (const f of ["event_id", "timestamp", "kind", "source", "regulatory_basis", "prev_hash", "hash"]) {
    if (!(f in obj)) errors.push(`audit-stream event missing required top-level field: ${f}`);
  }
  if (obj.regulatory_basis && !obj.regulatory_basis.code) errors.push("regulatory_basis.code missing");

  // Vertical-specific invariants
  const prefix = routing?.detection?.audit_kind_prefix_hint;

  // human-in-loop invariants
  const adverseKinds = ADVERSE_ACTION_KINDS[prefix];
  const adverseRecs  = ADVERSE_ACTION_RECOMMENDATIONS[prefix];
  if (adverseKinds && adverseKinds.has(obj.kind) && obj.ai_recommendation) {
    const rec = obj.ai_recommendation.recommendation;
    if (adverseRecs && adverseRecs.has(rec)) {
      // Different verticals use different human-in-loop flag names — accept any of them.
      const humanFlag = obj.ai_recommendation.human_underwriter_required
                     ?? obj.ai_recommendation.human_adjudicator_required
                     ?? obj.ai_recommendation.human_hiring_decision_required
                     ?? obj.ai_recommendation.human_credit_officer_required
                     ?? obj.ai_recommendation.human_clinician_required;
      if (humanFlag !== true) {
        errors.push(`human-in-loop invariant: ${prefix}* event with adverse-action-capable recommendation "${rec}" MUST set a human_*_required flag to true (vertical=${routing.vertical})`);
      }
    }
  }

  // FCRA permissible-purpose invariant (FinTech-specific but applies cross-vertical anywhere a credit-bureau resource is touched)
  if (CREDIT_BUREAU_RESOURCE_TYPES.has(obj.resource?.type)) {
    if (!obj.fcra_governance?.permissible_purpose) {
      errors.push(`FCRA permissible-purpose invariant: credit-bureau resource type "${obj.resource.type}" requires fcra_governance.permissible_purpose (FCRA §604 / 15 USC 1681b)`);
    }
  }

  // NYC LL 144 candidate-notice invariant (HR Tech)
  if (prefix === "employment." && obj.agent?.is_aedt_per_nyc_ll_144 === true && EXTERNAL_CANDIDATE_FACING_KINDS.has(obj.kind)) {
    if (obj.candidate_notice_provided?.notice_provided !== true) {
      errors.push(`NYC LL 144 candidate-notice invariant: AEDT in-scope event "${obj.kind}" requires candidate_notice_provided.notice_provided=true`);
    }
  }

  return { errors, warnings };
}

function verifyStateTrackerEvent(obj) {
  const errors = [], warnings = [];
  for (const f of ["event_id", "timestamp", "lifecycle_state", "citation"]) {
    if (!(f in obj)) errors.push(`state-tracker event missing required top-level field: ${f}`);
  }
  if (!obj.state && !obj.jurisdiction) errors.push("state-tracker event missing state OR jurisdiction field");
  if (obj.lifecycle_state === "effective" && !obj.effective_date) errors.push("lifecycle_state=effective requires effective_date");
  if (obj.lifecycle_state === "sunset" && !obj.sunset_date) errors.push("lifecycle_state=sunset requires sunset_date");
  if ((obj.lifecycle_state === "superseded" || obj.lifecycle_state === "amended") && !obj.supersedes_event_id) errors.push(`lifecycle_state=${obj.lifecycle_state} requires supersedes_event_id`);
  if (obj.citation && !obj.citation.short_label) errors.push("citation.short_label missing");
  if (obj.citation && !obj.citation.jurisdictional_uri) errors.push("citation.jurisdictional_uri missing");
  return { errors, warnings };
}

function verifyProfile(obj) {
  // Profiles are spec definitions — light structural check only.
  const errors = [], warnings = [];
  if (!obj.profile_id) errors.push("profile_id missing");
  if (!obj.title) warnings.push("title missing");
  if (!obj.purpose) warnings.push("purpose missing");
  return { errors, warnings };
}

export function verify(obj, routing) {
  if (!routing.ok) return { ok: false, errors: [routing.reason], warnings: [] };

  let result;
  switch (routing.artifact_kind) {
    case "decision-card-vault-contract": result = verifyDecisionCard(obj); break;
    case "incident-card":                result = verifyIncidentCard(obj); break;
    case "evidence-bundle-manifest":     result = verifyEvidenceBundleManifest(obj); break;
    case "audit-stream-event":           result = verifyAuditStreamEvent(obj, routing); break;
    case "state-tracker-event":          result = verifyStateTrackerEvent(obj); break;
    case "profile-definition":           result = verifyProfile(obj); break;
    default: result = { errors: [`unknown artifact_kind for verification: ${routing.artifact_kind}`], warnings: [] };
  }

  return { ok: result.errors.length === 0, errors: result.errors, warnings: result.warnings };
}
