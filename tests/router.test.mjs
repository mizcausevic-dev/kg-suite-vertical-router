// router.test.mjs — End-to-end test: every example file routes to the
// expected vertical, with no verification errors on the well-formed paths.
//
// Pure-Node ESM test runner — no external test framework dependency.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detect } from "../src/detect.mjs";
import { route } from "../src/route.mjs";
import { verify } from "../src/verify.mjs";

const manifest = JSON.parse(readFileSync(new URL("../manifest/profiles.json", import.meta.url), "utf8"));
const examplesDir = fileURLToPath(new URL("../examples/", import.meta.url));

const EXPECTED = {
  // SPEC-shape audit-stream events (regulatory_basis: {code, ...} object)
  "healthtech-fhir-event.ndjson":      {vertical: "HealthTech",              artifact_kind: "audit-stream-event"},
  "edtech-student-event.ndjson":       {vertical: "EdTech",                  artifact_kind: "audit-stream-event"},
  "proptech-mortgage-event.ndjson":    {vertical: "PropTech / Real Estate",  artifact_kind: "audit-stream-event"},
  "insurtech-claims-event.ndjson":     {vertical: "Insurance / InsurTech",   artifact_kind: "audit-stream-event"},
  "hrtech-employment-event.ndjson":    {vertical: "HR Tech / Employment AI", artifact_kind: "audit-stream-event"},
  "fintech-credit-event.ndjson":       {vertical: "FinTech",                 artifact_kind: "audit-stream-event"},

  // REF-IMPL-shape audit-stream events (regulatory_basis: [...] array, agent.*_id_tokenized)
  // One per vertical — completes 10/10 coverage.
  "healthtech-refimpl-event.ndjson":   {vertical: "HealthTech",              artifact_kind: "audit-stream-event"},
  "legaltech-refimpl-event.ndjson":    {vertical: "LegalTech",               artifact_kind: "audit-stream-event"},
  "energytech-refimpl-event.ndjson":   {vertical: "EnergyTech",              artifact_kind: "audit-stream-event"},
  "defensetech-refimpl-event.ndjson":  {vertical: "DefenseTech",             artifact_kind: "audit-stream-event"},
  "govtech-refimpl-event.ndjson":      {vertical: "GovTech",                 artifact_kind: "audit-stream-event"},
  "fintech-refimpl-event.ndjson":      {vertical: "FinTech",                 artifact_kind: "audit-stream-event"},
  "hrtech-refimpl-event.ndjson":       {vertical: "HR Tech / Employment AI", artifact_kind: "audit-stream-event"},
  "edtech-refimpl-event.ndjson":       {vertical: "EdTech",                  artifact_kind: "audit-stream-event"},
  "proptech-refimpl-event.ndjson":     {vertical: "PropTech / Real Estate",  artifact_kind: "audit-stream-event"},
  "insurtech-refimpl-event.ndjson":    {vertical: "Insurance / InsurTech",   artifact_kind: "audit-stream-event"},

  // Other artifact kinds
  "insurtech-decision-card.json":      {vertical: "Insurance / InsurTech",   artifact_kind: "decision-card-vault-contract"},
  "hrtech-incident-card.json":         {vertical: "HR Tech / Employment AI", artifact_kind: "incident-card"},
  "fintech-evidence-bundle.json":      {vertical: "FinTech",                 artifact_kind: "evidence-bundle-manifest"},
  "proptech-state-tracker.json":       {vertical: null,                       artifact_kind: "state-tracker-event"}
};

let failed = 0, passed = 0;

function parseFile(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (path.endsWith(".ndjson")) {
    // First line only for tests
    return JSON.parse(raw.split(/\r?\n/)[0]);
  }
  return JSON.parse(raw);
}

for (const file of readdirSync(examplesDir)) {
  if (!file.endsWith(".json") && !file.endsWith(".ndjson")) continue;
  const expected = EXPECTED[file];
  if (!expected) {
    console.log(`SKIP ${file} (no expectation)`);
    continue;
  }
  const obj = parseFile(`${examplesDir}${file}`);
  const detection = detect(obj);
  const routing = route(detection, manifest);

  // Routing check
  if (!routing.ok) {
    console.error(`FAIL ${file}: routing failed — ${routing.reason}`);
    failed++; continue;
  }
  if (routing.artifact_kind !== expected.artifact_kind) {
    console.error(`FAIL ${file}: artifact_kind mismatch (expected ${expected.artifact_kind}, got ${routing.artifact_kind})`);
    failed++; continue;
  }
  if (expected.vertical && routing.vertical !== expected.vertical) {
    console.error(`FAIL ${file}: vertical mismatch (expected ${expected.vertical}, got ${routing.vertical})`);
    failed++; continue;
  }

  // Verification check
  const verification = verify(obj, routing);
  if (!verification.ok) {
    console.error(`FAIL ${file}: verification errors:`);
    for (const e of verification.errors) console.error(`    ${e}`);
    failed++; continue;
  }

  console.log(`PASS ${file}  → vertical=${routing.vertical}  artifact_kind=${routing.artifact_kind}`);
  passed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
