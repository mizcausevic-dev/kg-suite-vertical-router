// route.mjs — Given a detection result + the router manifest, identify
// (vertical, source_repo, anchor_regulations, invariants) for the artifact.
//
// Routing strategy by artifact_kind:
//   - decision-card-vault-contract  → profile_id_hint must match a manifest.profiles entry whose artifact_kind = "decision-card-vault-contract"
//   - incident-card                  → profile_id_hint match
//   - evidence-bundle-manifest       → profile_id_hint match (resolved against profiles where artifact_kind = "evidence-bundle-profile")
//   - audit-stream-event             → audit_kind_prefix_hint match (e.g. "fhir." → HealthTech)
//   - state-tracker-event            → regulator_agency_code_hint pattern match + fallback by file name (handled by caller)
//   - profile                        → profile_id_hint match (the profile defines itself)

const ALLOWED_VERTICALS = [
  "HealthTech",
  "EdTech",
  "PropTech / Real Estate",
  "Insurance / InsurTech",
  "HR Tech / Employment AI",
  "FinTech"
];

function lookupProfile(manifest, profileId) {
  if (!profileId) return null;
  return manifest.profiles[profileId] || null;
}

function lookupAuditPrefix(manifest, prefix) {
  if (!prefix) return null;
  return manifest.audit_stream_kind_prefixes[prefix] || null;
}

function lookupStateTrackerByAgency(manifest, agencyCode) {
  // Crude prefix mapping for now. Examples seen so far:
  //   FDA-*           → HealthTech
  //   *-DOE / *-DOI   → ambiguous; lean on file naming
  //   NY-DFS / CA-DFPI / OCC / etc. → FinTech or InsurTech (DOI = Insurance)
  // The router prefers profile_id_hint when available; agency code is a fallback hint only.
  if (!agencyCode) return null;
  const code = agencyCode.toUpperCase();
  if (code.startsWith("FDA"))                                  return { vertical: "HealthTech", confidence: "high" };
  if (code.endsWith("-DOI") || code.includes("-DOI-"))         return { vertical: "Insurance / InsurTech", confidence: "high" };
  if (code.endsWith("-DOB") || code.includes("BANK") || code === "NY-DFS" || code === "CA-DFPI" || code === "IL-IDFPR" || code === "WA-DFI") return { vertical: "FinTech", confidence: "medium" };
  if (code === "NYC-DCWP" || code === "IL-DHR" || code === "MD-DOLLR" || code === "EEOC" || code === "OFCCP" || code === "CO-DOLE") return { vertical: "HR Tech / Employment AI", confidence: "high" };
  if (code.includes("ED") || code.includes("-DOE") || code === "USDOE")        return { vertical: "EdTech", confidence: "medium" };
  return { vertical: null, confidence: "none" };
}

export function route(detection, manifest) {
  if (detection.kind === "unknown") {
    return { ok: false, reason: detection.reason };
  }

  if (detection.kind === "profile") {
    // The artifact IS a profile, not an instance.
    const entry = lookupProfile(manifest, detection.profile_id_hint);
    if (!entry) {
      return {
        ok: false,
        reason: `unrecognized profile_id "${detection.profile_id_hint}" — not in router manifest. Open a PR to add it to manifest/profiles.json.`,
        detection
      };
    }
    return {
      ok: true,
      detection,
      vertical: entry.vertical,
      artifact_kind: "profile-definition",
      profile_kind: detection.profile_kind,
      source_repo: entry.source_repo,
      anchor_regulations: entry.anchor_regulations || [],
      invariants: []
    };
  }

  if (detection.artifact_kind === "audit-stream-event") {
    const entry = lookupAuditPrefix(manifest, detection.audit_kind_prefix_hint);
    if (!entry) {
      return {
        ok: false,
        reason: `unrecognized audit-stream kind prefix "${detection.audit_kind_prefix_hint || "(none)"}" (full kind: "${detection.event_kind}") — not in router manifest.audit_stream_kind_prefixes`,
        detection
      };
    }
    return {
      ok: true,
      detection,
      vertical: entry.vertical,
      artifact_kind: "audit-stream-event",
      source_repo: entry.source_repo,
      anchor_regulations: [],
      invariants: entry.invariants || []
    };
  }

  if (detection.artifact_kind === "state-tracker-event") {
    const agencyHint = lookupStateTrackerByAgency(manifest, detection.regulator_agency_code_hint);
    // State-tracker events may have agency codes that span multiple verticals
    // (e.g. CO-AG covers CO SB 24-205 which applies across PropTech / FinTech /
    // HR Tech / InsurTech). When the heuristic can't disambiguate we still
    // succeed routing but mark confidence "none" and emit a warning. Callers
    // can pass --vertical=... to override.
    if (!agencyHint || !agencyHint.vertical) {
      return {
        ok: true,
        detection,
        vertical: null,
        artifact_kind: "state-tracker-event",
        routing_confidence: "none",
        source_repo: null,
        anchor_regulations: [],
        invariants: [],
        warning: `state-tracker-event regulator.primary_agency_code "${detection.regulator_agency_code_hint || "(none)"}" did not match a single known vertical. Pass --vertical=... to override.`
      };
    }
    return {
      ok: true,
      detection,
      vertical: agencyHint.vertical,
      artifact_kind: "state-tracker-event",
      routing_confidence: agencyHint.confidence,
      source_repo: null,
      anchor_regulations: [],
      invariants: []
    };
  }

  // Decision Card / Incident Card / Evidence Bundle instances.
  //
  // Profile → instance artifact_kind mapping:
  //   - "decision-card-vault-contract" (profile) ↔ "decision-card-vault-contract" (instance)
  //   - "incident-card" (profile)                ↔ "incident-card" (instance)
  //   - "evidence-bundle-profile" (profile)      ↔ "evidence-bundle-manifest" (instance)
  // The third case is the only one where the profile-side name differs from
  // the instance-side name, because the "profile" describes the bundle shape
  // and the "manifest" is the actual bundle inventory.
  const PROFILE_TO_INSTANCE_KIND = {
    "decision-card-vault-contract":  "decision-card-vault-contract",
    "incident-card":                  "incident-card",
    "evidence-bundle-profile":        "evidence-bundle-manifest"
  };

  const entry = lookupProfile(manifest, detection.profile_id_hint);
  if (!entry) {
    return {
      ok: false,
      reason: `unrecognized profile reference "${detection.profile_id_hint || "(missing)"}" on ${detection.artifact_kind} — not in router manifest. Either add the profile to manifest/profiles.json or pass --vertical=... to bypass.`,
      detection
    };
  }
  const expectedInstanceKind = PROFILE_TO_INSTANCE_KIND[entry.artifact_kind];
  if (expectedInstanceKind !== detection.artifact_kind) {
    return {
      ok: false,
      reason: `profile_id "${detection.profile_id_hint}" defines artifact_kind "${entry.artifact_kind}" (expects instances of kind "${expectedInstanceKind}") but this instance is "${detection.artifact_kind}". Profile / instance shape mismatch.`,
      detection
    };
  }
  return {
    ok: true,
    detection,
    vertical: entry.vertical,
    artifact_kind: detection.artifact_kind,
    source_repo: entry.source_repo,
    anchor_regulations: entry.anchor_regulations || [],
    invariants: []
  };
}

export { ALLOWED_VERTICALS };
