// index.mjs — Programmatic API surface.
//
// Usage:
//   import { detect, route, verify, loadManifest } from "kg-suite-vertical-router";
//   const manifest = await loadManifest();
//   const detection = detect(parsed);
//   const routing   = route(detection, manifest);
//   const result    = verify(parsed, routing);

import { readFileSync } from "node:fs";
import { detect } from "./detect.mjs";
import { route } from "./route.mjs";
import { verify } from "./verify.mjs";

export { detect, route, verify };

export function loadManifest() {
  const manifestUrl = new URL("../manifest/profiles.json", import.meta.url);
  return JSON.parse(readFileSync(manifestUrl, "utf8"));
}

export function routeAndVerify(parsed, manifest) {
  const m = manifest || loadManifest();
  const detection = detect(parsed);
  const routing   = route(detection, m);
  if (!routing.ok) return { detection, routing, verification: null, ok: false };
  const verification = verify(parsed, routing);
  return { detection, routing, verification, ok: verification.ok };
}
