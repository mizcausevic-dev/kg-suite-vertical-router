// detect.mjs — Identify Suite artifact kind from a parsed JSON object.
//
// Returns: { kind, version, profile_id_hint, schema_hint, audit_kind_prefix_hint }
//
// Heuristics in priority order:
//   1. Top-level *_profile_version field → it IS a profile, not an instance
//   2. decision_card_version → Decision Card instance
//   3. incident_card_version → Incident Card instance
//   4. evidence_bundle_version → Evidence Bundle manifest instance
//   5. event_id + kind + prev_hash + hash → audit-stream event
//   6. event_id + state + lifecycle_state → state-tracker event
//   7. otherwise: unknown
//
// A single NDJSON file containing audit-stream events MUST be split per line
// before calling detect(); detect() operates on one parsed object.

export function detect(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { kind: "unknown", reason: "input is not a JSON object" };
  }

  // Tier 1: profiles (the spec definition, not an instance of it)
  if (typeof obj.decision_card_profile_version === "string") {
    return {
      kind: "profile",
      profile_kind: "decision-card-vault-contract",
      version: obj.decision_card_profile_version,
      profile_id_hint: obj.profile_id
    };
  }
  if (typeof obj.incident_card_profile_version === "string") {
    return {
      kind: "profile",
      profile_kind: "incident-card",
      version: obj.incident_card_profile_version,
      profile_id_hint: obj.profile_id
    };
  }
  if (typeof obj.evidence_bundle_profile_version === "string") {
    return {
      kind: "profile",
      profile_kind: "evidence-bundle-profile",
      version: obj.evidence_bundle_profile_version,
      profile_id_hint: obj.profile_id
    };
  }

  // Tier 2: Decision Card instance (has vault_contract block with profile pointer)
  if (typeof obj.decision_card_version === "string") {
    return {
      kind: "instance",
      artifact_kind: "decision-card-vault-contract",
      version: obj.decision_card_version,
      profile_id_hint: obj.vault_contract?.profile,
      decision_id: obj.decision_id
    };
  }

  // Tier 3: Incident Card instance
  if (typeof obj.incident_card_version === "string") {
    return {
      kind: "instance",
      artifact_kind: "incident-card",
      version: obj.incident_card_version,
      // Incident Card instances reference their profile via convention or
      // by the auditor/buyer's published profile_id; we'll try a few common
      // hint fields.
      profile_id_hint: obj.profile_id || obj.labels?.profile,
      incident_id: obj.incident_id,
      event_type_hint: obj.event_type
    };
  }

  // Tier 4: Evidence Bundle manifest instance
  if (typeof obj.evidence_bundle_version === "string") {
    return {
      kind: "instance",
      artifact_kind: "evidence-bundle-manifest",
      version: obj.evidence_bundle_version,
      profile_id_hint: obj.bundle?.labels?.profile,
      bundle_id: obj.bundle?.id
    };
  }

  // Tier 5: audit-stream event (hash-chained record)
  if (typeof obj.event_id === "string" && typeof obj.kind === "string" && typeof obj.prev_hash === "string" && typeof obj.hash === "string") {
    const kindStr = obj.kind;
    const prefixMatch = kindStr.match(/^([a-z0-9-]+)\./);
    return {
      kind: "instance",
      artifact_kind: "audit-stream-event",
      event_id: obj.event_id,
      event_kind: kindStr,
      audit_kind_prefix_hint: prefixMatch ? prefixMatch[1] + "." : null,
      regulatory_basis_code_hint: obj.regulatory_basis?.code
    };
  }

  // Tier 6: state-tracker event (per-state lifecycle ledger)
  if (typeof obj.event_id === "string" && typeof obj.state === "string" && typeof obj.lifecycle_state === "string") {
    return {
      kind: "instance",
      artifact_kind: "state-tracker-event",
      event_id: obj.event_id,
      state: obj.state,
      lifecycle_state: obj.lifecycle_state,
      regulator_agency_code_hint: obj.regulator?.primary_agency_code
    };
  }

  // Tier 6b: jurisdiction (sub-state) tracker event — HR Tech uses jurisdiction field instead of state
  if (typeof obj.event_id === "string" && typeof obj.jurisdiction === "string" && typeof obj.lifecycle_state === "string") {
    return {
      kind: "instance",
      artifact_kind: "state-tracker-event",
      event_id: obj.event_id,
      state: obj.jurisdiction,
      lifecycle_state: obj.lifecycle_state,
      regulator_agency_code_hint: obj.regulator?.primary_agency_code
    };
  }

  return {
    kind: "unknown",
    reason: "no Suite artifact-kind marker (decision_card_version / incident_card_version / evidence_bundle_version / event_id+hash / event_id+lifecycle_state) found at top level"
  };
}
