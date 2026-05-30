#!/usr/bin/env node
// cli.mjs — kg-suite-route command-line interface.
//
// Usage:
//   kg-suite-route <path>                 # route + verify a single artifact JSON
//   kg-suite-route <path.ndjson>          # route + verify each line as an audit-stream event
//   kg-suite-route <path> --json          # machine-readable JSON output
//   kg-suite-route --version
//   kg-suite-route --manifest             # print the router manifest path
//
// Exit codes:
//   0 — artifact routed + verified, no errors
//   1 — routing failed (unrecognized profile / kind prefix / artifact shape)
//   2 — verification failed (structural or invariant errors)
//   3 — usage / IO error

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detect } from "./detect.mjs";
import { route } from "./route.mjs";
import { verify } from "./verify.mjs";

const manifestPath = new URL("../manifest/profiles.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

function usage() {
  console.error(`kg-suite-route v${pkg.version}
Usage:
  kg-suite-route <artifact.json>                 route + verify one artifact
  kg-suite-route <stream.ndjson>                 route + verify each line (audit-stream)
  kg-suite-route <path> --json                   machine-readable JSON output
  kg-suite-route --version                       print version
  kg-suite-route --manifest                       print router manifest path

Exit codes: 0=ok, 1=routing failed, 2=verification failed, 3=usage/IO`);
}

function routeAndVerify(parsed) {
  const detection = detect(parsed);
  const routing   = route(detection, manifest);
  if (!routing.ok) return { detection, routing, verification: null };
  const verification = verify(parsed, routing);
  return { detection, routing, verification };
}

function formatLine(result, jsonMode) {
  if (jsonMode) return JSON.stringify(result);
  const { detection, routing, verification } = result;
  const lines = [];
  if (!routing.ok) {
    lines.push(`✗ routing failed`);
    lines.push(`  reason: ${routing.reason}`);
    if (detection.kind) lines.push(`  detected_kind: ${detection.kind}`);
    if (detection.artifact_kind) lines.push(`  artifact_kind: ${detection.artifact_kind}`);
    if (detection.profile_id_hint) lines.push(`  profile_id_hint: ${detection.profile_id_hint}`);
    return lines.join("\n");
  }
  const ok = verification && verification.ok;
  lines.push(`${ok ? "✓" : "✗"} vertical=${routing.vertical}  artifact_kind=${routing.artifact_kind}`);
  if (detection.profile_id_hint) lines.push(`  profile_id: ${detection.profile_id_hint}`);
  if (detection.event_kind) lines.push(`  event_kind: ${detection.event_kind}`);
  if (detection.decision_id) lines.push(`  decision_id: ${detection.decision_id}`);
  if (detection.incident_id) lines.push(`  incident_id: ${detection.incident_id}`);
  if (detection.bundle_id) lines.push(`  bundle_id: ${detection.bundle_id}`);
  if (detection.state) lines.push(`  state/jurisdiction: ${detection.state}  lifecycle_state: ${detection.lifecycle_state}`);
  if (routing.source_repo) lines.push(`  source_repo: ${routing.source_repo}`);
  if (routing.anchor_regulations?.length) lines.push(`  anchor_regulations: ${routing.anchor_regulations.join(", ")}`);
  if (routing.invariants?.length) lines.push(`  invariants_checked: ${routing.invariants.join(", ")}`);
  if (routing.routing_confidence) lines.push(`  routing_confidence: ${routing.routing_confidence}`);
  if (verification?.errors?.length) {
    lines.push(`  errors:`);
    for (const e of verification.errors) lines.push(`    - ${e}`);
  }
  if (verification?.warnings?.length) {
    lines.push(`  warnings:`);
    for (const w of verification.warnings) lines.push(`    - ${w}`);
  }
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(args.length === 0 ? 3 : 0);
  }
  if (args.includes("--version")) {
    console.log(pkg.version);
    process.exit(0);
  }
  if (args.includes("--manifest")) {
    console.log(fileURLToPath(manifestPath));
    process.exit(0);
  }

  const jsonMode = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    usage();
    process.exit(3);
  }
  const inputPath = positional[0];

  let raw;
  try { raw = readFileSync(inputPath, "utf8"); }
  catch (e) { console.error(`could not read ${inputPath}: ${e.message}`); process.exit(3); }

  const trimmed = raw.trim();
  let routingFailed = false, verificationFailed = false;

  // NDJSON: each line a separate artifact (audit-stream events)
  if (inputPath.endsWith(".ndjson") || (trimmed.indexOf("\n") > 0 && trimmed[0] === "{" && !trimmed.startsWith("{\n"))) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== "");
    const all = [];
    for (const [i, line] of lines.entries()) {
      let parsed;
      try { parsed = JSON.parse(line); }
      catch (e) { console.error(`line ${i+1}: not valid JSON — ${e.message}`); process.exit(3); }
      const result = routeAndVerify(parsed);
      if (!result.routing.ok) routingFailed = true;
      else if (result.verification && !result.verification.ok) verificationFailed = true;
      if (jsonMode) all.push(result);
      else { console.log(`event ${i+1}/${lines.length}:`); console.log(formatLine(result, false)); }
    }
    if (jsonMode) console.log(JSON.stringify(all, null, 2));
    else {
      const passed = lines.length - (routingFailed ? 1 : 0) - (verificationFailed ? 1 : 0);
      console.log(`\n${lines.length} events processed.`);
    }
  } else {
    let parsed;
    try { parsed = JSON.parse(trimmed); }
    catch (e) { console.error(`not valid JSON: ${e.message}`); process.exit(3); }
    const result = routeAndVerify(parsed);
    if (!result.routing.ok) routingFailed = true;
    else if (result.verification && !result.verification.ok) verificationFailed = true;
    console.log(formatLine(result, jsonMode));
  }

  if (routingFailed) process.exit(1);
  if (verificationFailed) process.exit(2);
  process.exit(0);
}

main();
