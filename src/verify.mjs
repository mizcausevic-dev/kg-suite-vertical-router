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
// Two audit-stream event SHAPES are supported:
//   1. SPEC shape — `regulatory_basis: {code, ...}` object + `ai_recommendation.human_X_required` boolean flag
//   2. REF-IMPL shape — `regulatory_basis: ["..."]` array + `agent.human_X_id_tokenized` string id
//
// The router intentionally does NOT re-run the source-repo's full schema verifier — it does the routing + invariant-level checks that prove the artifact belongs to the claimed vertical and obeys the cross-cutting invariants. For full invariant verification of ref-impl-shape streams, use the ref impl's own verifier.mjs (referenced via reference_repo in the manifest).

// ============================================================
// SPEC-SHAPE invariant tables (object-form regulatory_basis +
// ai_recommendation.human_X_required boolean flag).
// ============================================================

const ADVERSE_ACTION_KINDS_SPEC = {
  "mortgage.":   new Set(["mortgage.application.recommendation-produced"]),
  "insurance.":  new Set(["insurance.underwriting.recommendation-produced", "insurance.claim.recommendation-produced", "insurance.claim.triage-produced"]),
  "employment.": new Set(["employment.hiring.recommendation-produced", "employment.promotion.recommendation-produced", "employment.performance.recommendation-produced", "employment.termination.recommendation-produced", "employment.hiring.video-interview-scored", "employment.hiring.assessment-scored"]),
  "fintech.":    new Set(["fintech.consumer-credit.recommendation-produced", "fintech.section-1071-small-business.recommendation-produced", "fintech.deposit-account.opening-evaluated", "fintech.consumer-credit.line-management-evaluated"])
};

const ADVERSE_ACTION_RECOMMENDATIONS_SPEC = {
  "mortgage.":   new Set(["decline"]),
  "insurance.":  new Set(["decline", "rate-up", "approve-with-conditions"]),
  "employment.": new Set(["decline", "do-not-promote", "performance-below", "terminate-recommended"]),
  "fintech.":    new Set(["decline", "approve-with-conditions", "counter-offer", "freeze", "reduce-line"])
};

const CREDIT_BUREAU_RESOURCE_TYPES = new Set([
  "credit-bureau-tradeline",
  "credit-bureau-inquiry-history",
  "credit-bureau-inquiry",
  "credit-bureau-record"
]);

const EXTERNAL_CANDIDATE_FACING_KINDS_SPEC = new Set([
  "employment.hiring.sourcing-ranked",
  "employment.hiring.resume-screened",
  "employment.hiring.video-interview-scored",
  "employment.hiring.assessment-scored",
  "employment.hiring.recommendation-produced",
  "employment.hiring.adverse-action-evaluated"
]);

// ============================================================
// REF-IMPL-SHAPE invariant tables (array-form regulatory_basis +
// agent.human_X_id_tokenized string-id field).
// ============================================================

// Adverse-action-capable kinds per ref-impl vertical prefix.
// PropTech is structurally distinct: the UNIVERSAL rule fires regardless
// of recommendation, so the kind set alone is the trigger.
const ADVERSE_ACTION_CAPABLE_KINDS_REFIMPL = {
  "proptech.":   new Set([
    "proptech.mortgage.application-decision-recommended",
    "proptech.mortgage.refinance-decision-recommended",
    "proptech.mortgage.modification-decision-recommended",
    "proptech.mortgage.pricing-decision-recommended",
    "proptech.mortgage.appraisal-review-recommended"
  ]),
  "insurtech.":  new Set([
    "insurtech.claims.triage-recommended",
    "insurtech.claims.fraud-flag-recommended",
    "insurtech.underwriting.application-decision-recommended",
    "insurtech.underwriting.rating-decision-recommended"
  ]),
  "hrtech.":     new Set([
    "hrtech.hiring.candidate-decision-recommended",
    "hrtech.hiring.interview-scored-by-ai",
    "hrtech.hiring.candidate-ai-screened"
  ]),
  "fintech.":    new Set([
    "fintech.credit.application-decision-recommended",
    "fintech.credit.ai-score-produced",
    "fintech.credit.bureau-report-pulled"
  ])
};

const ADVERSE_RECOMMENDATIONS_REFIMPL = {
  "insurtech.":  new Set(["decline", "rate-up", "approve-with-conditions", "deny", "partial-pay", "investigate-for-fraud"]),
  "hrtech.":     new Set(["decline", "do-not-advance", "reject"]),
  "fintech.":    new Set(["decline", "approve-with-conditions", "counter-offer"])
};

// VALID FERPA bases per 34 CFR Part 99.30 / 99.31 (EdTech ref impl)
const VALID_FERPA_BASES = new Set([
  "school-official-with-legitimate-educational-interest",
  "prior-written-consent-parent",
  "prior-written-consent-eligible-student",
  "directory-information-opted-in",
  "audit-or-evaluation-99-31-a-3",
  "financial-aid-99-31-a-4",
  "judicial-order-or-subpoena-99-31-a-9",
  "health-or-safety-emergency-99-31-a-10"
]);

const COPPA_CHILD_AGE_THRESHOLD = 13;
const NAIC_BIAS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const ECOA_30_DAY_NOTICE_MS = 30 * 24 * 60 * 60 * 1000;

// ============================================================
// Structural verifiers (unchanged).
// ============================================================

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

// ============================================================
// audit-stream event verifier — dispatches on shape.
// ============================================================

function isRefImplShape(obj) {
  // Ref-impl events carry regulatory_basis as ARRAY; spec events carry as OBJECT with .code.
  return Array.isArray(obj.regulatory_basis);
}

function verifyAuditStreamEventSpec(obj, routing) {
  const errors = [], warnings = [];
  // Hard-required: hash-chain skeleton + identity. regulatory_basis is a strong recommendation but
  // not enforced at router level — older ref impls (notably HealthTech's fhir-resource-access-audit
  // reference) pre-date the convention. Surface as warning so router stays permissive.
  for (const f of ["event_id", "timestamp", "kind", "source", "prev_hash", "hash"]) {
    if (!(f in obj)) errors.push(`audit-stream event (spec-shape) missing required top-level field: ${f}`);
  }
  if (!("regulatory_basis" in obj)) warnings.push("regulatory_basis missing — recommended but not enforced at router level (router does shape + cross-vertical invariants only)");
  else if (obj.regulatory_basis && !Array.isArray(obj.regulatory_basis) && !obj.regulatory_basis.code) errors.push("regulatory_basis.code missing (spec-shape requires {code} object)");

  const prefix = routing?.detection?.audit_kind_prefix_hint;

  // human-in-loop invariants
  const adverseKinds = ADVERSE_ACTION_KINDS_SPEC[prefix];
  const adverseRecs  = ADVERSE_ACTION_RECOMMENDATIONS_SPEC[prefix];
  if (adverseKinds && adverseKinds.has(obj.kind) && obj.ai_recommendation) {
    const rec = obj.ai_recommendation.recommendation;
    if (adverseRecs && adverseRecs.has(rec)) {
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

  if (CREDIT_BUREAU_RESOURCE_TYPES.has(obj.resource?.type)) {
    if (!obj.fcra_governance?.permissible_purpose) {
      errors.push(`FCRA permissible-purpose invariant: credit-bureau resource type "${obj.resource.type}" requires fcra_governance.permissible_purpose (FCRA §604 / 15 USC 1681b)`);
    }
  }

  if (prefix === "employment." && obj.agent?.is_aedt_per_nyc_ll_144 === true && EXTERNAL_CANDIDATE_FACING_KINDS_SPEC.has(obj.kind)) {
    if (obj.candidate_notice_provided?.notice_provided !== true) {
      errors.push(`NYC LL 144 candidate-notice invariant: AEDT in-scope event "${obj.kind}" requires candidate_notice_provided.notice_provided=true`);
    }
  }

  return { errors, warnings };
}

function verifyAuditStreamEventRefImpl(obj, routing) {
  const errors = [], warnings = [];
  // Ref-impl shape requires the same hash-chain skeleton minus regulatory_basis.code.
  for (const f of ["event_id", "timestamp", "kind", "source", "regulatory_basis", "prev_hash", "hash"]) {
    if (!(f in obj)) errors.push(`audit-stream event (ref-impl-shape) missing required top-level field: ${f}`);
  }
  if (!Array.isArray(obj.regulatory_basis) || obj.regulatory_basis.length === 0) {
    errors.push("regulatory_basis must be a non-empty array of citation codes (ref-impl shape)");
  }

  const prefix = routing?.detection?.audit_kind_prefix_hint;
  const rec = obj.outcome?.recommendation;
  const eventMs = Date.parse(obj.timestamp);

  // INVARIANT — PropTech UNIVERSAL human-underwriter (fires on adverse-action-capable kind regardless of recommendation)
  if (prefix === "proptech." && ADVERSE_ACTION_CAPABLE_KINDS_REFIMPL["proptech."].has(obj.kind)) {
    if (!obj.agent?.human_underwriter_id_tokenized) {
      errors.push(`PropTech-UNIVERSAL invariant: adverse-action-capable kind "${obj.kind}" requires agent.human_underwriter_id_tokenized regardless of recommendation (Reg B + Fair Housing + RESPA risk profile)`);
    }
    // ECOA 30-day notice anchored on application-completed-at
    const adverseProp = new Set(["decline", "approve-with-conditions", "counter-offer", "withdraw-incomplete"]);
    if (adverseProp.has(rec) && obj.agent?.application_completed_at) {
      const noticeAt = obj.agent?.adverse_action_notice_sent_at;
      if (!noticeAt) {
        errors.push(`ECOA Reg B invariant: adverse recommendation "${rec}" requires agent.adverse_action_notice_sent_at (12 CFR §1002.9 — 30-day clock)`);
      } else {
        const completedMs = Date.parse(obj.agent.application_completed_at);
        const noticeMs = Date.parse(noticeAt);
        if (Number.isFinite(completedMs) && Number.isFinite(noticeMs) && noticeMs - completedMs > ECOA_30_DAY_NOTICE_MS) {
          errors.push(`ECOA Reg B 30-day notice clock missed — notice sent ${Math.round((noticeMs - completedMs) / (24*3600*1000))} days after completed application (limit 30)`);
        }
      }
    }
  }

  // INVARIANT — InsurTech SCOPED human-adjudicator + NAIC bounded-backward 90-day bias window
  if (prefix === "insurtech." && ADVERSE_ACTION_CAPABLE_KINDS_REFIMPL["insurtech."].has(obj.kind)) {
    if (ADVERSE_RECOMMENDATIONS_REFIMPL["insurtech."].has(rec)) {
      if (!obj.agent?.human_adjudicator_id_tokenized) {
        errors.push(`InsurTech-SCOPED invariant: adverse recommendation "${rec}" on adverse-action-capable kind "${obj.kind}" requires agent.human_adjudicator_id_tokenized (NAIC Model Bulletin + state unfair-discrimination)`);
      }
    }
    const win = obj.agent?.bias_monitoring_window_completed_at;
    if (!win) {
      errors.push(`NAIC bias-monitoring invariant: kind "${obj.kind}" requires agent.bias_monitoring_window_completed_at`);
    } else {
      const winMs = Date.parse(win);
      if (Number.isFinite(eventMs) && Number.isFinite(winMs)) {
        if (winMs > eventMs) errors.push("NAIC bias-monitoring window timestamp is AFTER event — monitoring must precede the AI decision");
        else if (eventMs - winMs > NAIC_BIAS_WINDOW_MS) errors.push(`NAIC bias-monitoring window stale (${Math.round((eventMs - winMs) / (24*3600*1000))} days before event, limit 90)`);
      }
    }
  }

  // INVARIANT — EdTech FERPA basis enumeration + COPPA must-precede-event consent
  if (prefix === "edtech.") {
    if (!obj.agent?.ferpa_basis) {
      errors.push(`FERPA invariant: every student-data access event requires agent.ferpa_basis citation (34 CFR Part 99)`);
    } else if (!VALID_FERPA_BASES.has(obj.agent.ferpa_basis)) {
      errors.push(`FERPA invariant: agent.ferpa_basis "${obj.agent.ferpa_basis}" is not in the enumerated set of FERPA disclosure permissions (34 CFR 99.30 / 99.31)`);
    }
    const age = obj.resource?.student_age;
    if (typeof age === "number" && age < COPPA_CHILD_AGE_THRESHOLD) {
      if (obj.agent?.coppa_consent_obtained !== true) {
        errors.push(`COPPA invariant: student age ${age} < 13 requires agent.coppa_consent_obtained=true (16 CFR §312.4)`);
      } else if (!obj.agent?.coppa_consent_obtained_at) {
        errors.push(`COPPA invariant: under-13 event requires agent.coppa_consent_obtained_at timestamp`);
      } else {
        const consentMs = Date.parse(obj.agent.coppa_consent_obtained_at);
        if (Number.isFinite(consentMs) && Number.isFinite(eventMs) && consentMs > eventMs) {
          errors.push(`COPPA invariant: consent timestamp is AFTER event — consent must be obtained BEFORE collection`);
        }
      }
    }
  }

  // (Other vertical-specific invariants — LegalTech privilege-tier, EnergyTech 1h clock,
  //  DefenseTech 72h clock, GovTech impact-assessment — are checked by the ref impl's own
  //  verifier.mjs and surfaced here as routing.invariants. Router does light validation only.)

  return { errors, warnings };
}

function verifyAuditStreamEvent(obj, routing) {
  if (isRefImplShape(obj)) return verifyAuditStreamEventRefImpl(obj, routing);
  return verifyAuditStreamEventSpec(obj, routing);
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
