// AURA-PALM-G6-D0 — Hand-constructed SYNTHETIC feature objects. No photograph, detector run or person is behind any of them.
// Coordinates are in palm-normalized-v1 (x radial→ulnar, y finger base→wrist, unit = palm width).

const clone = (o) => JSON.parse(JSON.stringify(o));

const DTC_PTS = [{ x: 0.95, y: 0.2 }, { x: 0.8, y: 0.19 }, { x: 0.65, y: 0.17 }, { x: 0.5, y: 0.14 }, { x: 0.38, y: 0.1 }, { x: 0.3, y: 0.06 }];
const PTC_PTS = [{ x: 0.05, y: 0.32 }, { x: 0.25, y: 0.35 }, { x: 0.45, y: 0.38 }, { x: 0.65, y: 0.42 }, { x: 0.8, y: 0.45 }];
const TC_PTS = [{ x: 0.06, y: 0.34 }, { x: 0.18, y: 0.45 }, { x: 0.3, y: 0.6 }, { x: 0.36, y: 0.75 }, { x: 0.34, y: 0.9 }, { x: 0.27, y: 1.05 }];

export function crease(id, cls, points, conf = 0.9, extra = {}) {
  return {
    id,
    geometry: { points: clone(points) },
    continuity: { gapsBridged: 0, breaks: 0 },
    branches: [],
    detection: { confidence: conf, confidenceBasis: 'synthetic-declared' },
    identity: cls === 'unclassified'
      ? { anatomicalClass: 'unclassified', classConfidence: 0, classSource: 'none' }
      : { anatomicalClass: cls, classConfidence: conf, classSource: 'synthetic-declared' },
    ...clone(extra),
  };
}

export function base({ conf = 0.9, scan = 0.9 } = {}) {
  return {
    schema: 'aura.palm.features',
    schemaVersion: '0.1.0',
    synthetic: true,
    capture: {
      handedness: { value: 'right', source: 'user-declared' },
      dominantHand: 'right',
      orientation: { rotationDeg: 4, palmFacing: true },
      quality: { status: 'accepted', issues: [] },
    },
    landmarks: { present: true, source: { detector: 'synthetic-fixture', version: '0.1.0' } },
    creases: {
      source: { detector: 'synthetic-fixture', version: '0.1.0' },
      coordinateFrame: 'palm-normalized-v1',
      items: [crease('c-dtc', 'DTC', DTC_PTS, conf), crease('c-ptc', 'PTC', PTC_PTS, conf), crease('c-tc', 'TC', TC_PTS, conf)],
      expectedButMissing: [],
      conflicts: [],
    },
    scanConfidence: { value: scan, basis: 'synthetic-declared' },
  };
}

const at = (f, id) => f.creases.items.find((c) => c.id === id);

/** 1. Strong evidence: all majors clear, plus branches, fork, wide arc and a central vertical crease. */
export function strong() {
  const f = base({ conf: 0.92, scan: 0.9 });
  at(f, 'c-dtc').branches = [{ atT: 0.3, direction: 'distal', lengthNorm: 0.06 }, { atT: 0.6, direction: 'distal', lengthNorm: 0.05 }];
  at(f, 'c-ptc').branches = [{ atT: 0.9, direction: 'proximal', lengthNorm: 0.07 }];
  at(f, 'c-tc').geometry.points = [{ x: 0.06, y: 0.34 }, { x: 0.2, y: 0.45 }, { x: 0.36, y: 0.6 }, { x: 0.46, y: 0.75 }, { x: 0.42, y: 0.9 }, { x: 0.3, y: 1.06 }];
  f.creases.items.push(crease('c-vert', 'MINOR', [{ x: 0.52, y: 1.0 }, { x: 0.51, y: 0.75 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.36 }], 0.88));
  return f;
}

/** 2. Weak evidence: everything visible but only moderately confident → tentative wording only. */
export function weak() { return base({ conf: 0.6, scan: 0.7 }); }

/** 3. Missing major crease: TC not detected. */
export function missingMajor() {
  const f = base();
  f.creases.items = f.creases.items.filter((c) => c.id !== 'c-tc');
  f.creases.expectedButMissing = ['TC'];
  return f;
}

/** 4. Contradictory features: two creases both labelled PTC; DTC carries a recorded conflict; TC is fine but broken. */
export function contradictory() {
  const f = base();
  f.creases.items.push(crease('c-ptc2', 'PTC', [{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.55 }, { x: 0.7, y: 0.62 }], 0.85));
  f.creases.conflicts = [{ ids: ['c-dtc'], kind: 'overlap' }];
  at(f, 'c-tc').continuity = { gapsBridged: 0, breaks: 1 };
  return f;
}

/** 5. Poor scan quality: G5-I1-style quality gate did not accept the image. */
export function poorQuality() {
  const f = base();
  f.capture.quality = { status: 'needs-retake', issues: ['blurry', 'too-dark'] };
  return f;
}

/** 6. Multiple possible interpretations: slope values sit on variant boundaries. */
export function multipleInterpretations() {
  const f = base();
  // PTC drop 0.105 (boundary 0.11, margin 0.015) → balanced + sloping
  at(f, 'c-ptc').geometry.points = [{ x: 0.05, y: 0.32 }, { x: 0.3, y: 0.35 }, { x: 0.55, y: 0.39 }, { x: 0.8, y: 0.425 }];
  // DTC drop 0.055 (boundary 0.05) → straight + gentle
  at(f, 'c-dtc').geometry.points = [{ x: 0.95, y: 0.2 }, { x: 0.7, y: 0.18 }, { x: 0.5, y: 0.165 }, { x: 0.3, y: 0.145 }];
  return f;
}

/** 7. Research-detector output as it actually exists today: unlabelled polylines, uncalibrated scores. */
export function d1Unclassified() {
  const f = base();
  f.creases.source = { detector: 'creases-directional-d1', version: 'frozen-d1' };
  f.creases.items = f.creases.items.map((c, i) => ({ ...crease(`cand${i + 1}`, 'unclassified', c.geometry.points), detection: { confidence: 0.8, confidenceBasis: 'uncalibrated-detector-score' } }));
  return f;
}

/** 8. D3-B polylines that a user has confirmed (hypothetical future flow): capped at tentative. */
export function d3bUserConfirmed() {
  const f = base();
  f.creases.source = { detector: 'creases-directional-d3b', version: 'D3B-C' };
  for (const c of f.creases.items) { c.detection = { confidence: 0.9, confidenceBasis: 'uncalibrated-detector-score' }; c.identity = { anatomicalClass: c.identity.anatomicalClass, classConfidence: 0.95, classSource: 'user-confirmed' }; }
  return f;
}

/** 9. Ambiguous identity: the PTC candidate could almost as well be the DTC. */
export function ambiguousIdentity() {
  const f = base();
  at(f, 'c-ptc').identity = { anatomicalClass: 'PTC', classConfidence: 0.7, classSource: 'synthetic-declared', alternatives: [{ anatomicalClass: 'DTC', classConfidence: 0.62 }] };
  return f;
}

/** 10. Low-confidence negative control: creases present but faint. */
export function lowConfidence() { return base({ conf: 0.35, scan: 0.8 }); }

// ---------- R1 additions (AURA-PALM-G6-D0-R1): demonstrate the five fixes. Fixtures 01–10 are unchanged. ----------

/** 11. Unknown frame: handedness unknown and palm side unconfirmed (R1-F4). */
export function unknownFrame() {
  const f = strong();
  f.capture.handedness = { value: 'unknown', source: 'unknown' };
  f.capture.orientation.palmFacing = null;
  return f;
}

/** 12. Research detector with tracker gap-bridging on the thenar crease (R1-F3): gapsBridged is metadata, never a break. */
export function gapsBridgedNotBreaks() {
  const f = d3bUserConfirmed();
  at(f, 'c-tc').continuity = { gapsBridged: 3, breaks: 0 };
  at(f, 'c-ptc').continuity = { gapsBridged: 2, breaks: 0 };
  return f;
}

/** 13. Ambiguous endpoints (R1-F5): the PTC polyline's ends share almost the same x, so radial/ulnar roles are unknown. */
export function ambiguousEndpoints() {
  const f = base();
  at(f, 'c-ptc').geometry.points = [{ x: 0.4, y: 0.3 }, { x: 0.42, y: 0.4 }, { x: 0.405, y: 0.5 }];
  return f;
}

export const SAMPLE_FIXTURES = Object.freeze({
  '01-strong-evidence': strong,
  '02-weak-evidence': weak,
  '03-missing-major-crease': missingMajor,
  '04-contradictory-features': contradictory,
  '05-poor-scan-quality': poorQuality,
  '06-multiple-interpretations': multipleInterpretations,
  '07-research-detector-unclassified': d1Unclassified,
  '08-d3b-user-confirmed': d3bUserConfirmed,
  '09-ambiguous-identity': ambiguousIdentity,
  '10-low-confidence': lowConfidence,
  '11-r1-unknown-frame': unknownFrame,
  '12-r1-gaps-bridged-not-breaks': gapsBridgedNotBreaks,
  '13-r1-ambiguous-endpoints': ambiguousEndpoints,
});
