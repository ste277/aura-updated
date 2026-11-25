// AURA-PALM-03-E1 -- personalised interpretation engine identity.
// DEVELOPMENT ONLY. SYNTHETIC ONLY. A separate identity from the frozen G6 engine (prototype/), which is not
// imported, wrapped or modified by E1. No real-image, camera, network or storage path exists in this package.

export const E1_ENGINE = Object.freeze({
  id: 'aura.palm.e1-reading',
  version: '0.1.0',
  libraryVersion: 'palm-03-c1-library@0.4.0-draft',
  featureSetVersion: 'palm-03-i1-feature-set@0.1.0',
  descriptorVersion: 'e1-zone-descriptor@0.1.0',
  syntheticOnly: true,
  contentStatus: 'UNREVIEWED_RESEARCH_CONTENT',
});

export const MODES = Object.freeze(['combined', 'indian-only', 'western-only']);
export const DEFAULT_MODE = 'combined';

/** Capabilities implemented by this milestone (C1 e1Planning essential tier). Nothing else is ever available. */
export const IMPLEMENTED_CAPABILITIES = Object.freeze(['E1-E1', 'E1-E2', 'E1-E3', 'E1-E4', 'E1-E5']);

/** The four product domains, in output order; their catalogue categories come from library.readingModes.domains. */
export const DOMAINS = Object.freeze(['personality', 'relationships', 'career', 'life-direction']);

/** Typed error for every rejection (invalid input, invalid catalogue, invalid option). */
export class E1Error extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = 'E1Error';
    this.code = code;
  }
}

/** C1 rev. 4 record inventory (29). The loader refuses a catalogue that adds, drops or reclassifies a record. */
export const RECORD_MANIFEST = Object.freeze({
  'eligible-initial': Object.freeze(["C1-IN-PITR-KNOWLEDGE", "C1-IN-URDHVA-MIDDLE", "C1-IN-URDHVA-INDEX", "C1-IN-URDHVA-RING", "C1-IN-URDHVA-LITTLE", "C1-WE-HEAD-STRAIGHT", "C1-WE-HEAD-SLOPING", "C1-WE-FINGER-LONG", "C1-WE-FINGER-SHORT", "C1-WE-RING-LONG", "C1-WE-HEART-JUPITER", "C1-WE-HEART-BETWEEN"]),
  'eligible-later': Object.freeze(["C1-IN-PALM-RAISED-GENEROUS", "C1-IN-MATSYA-PAIR-HOSPITALITY", "C1-IN-MARK-FISHTAIL-LEARNING", "C1-IN-MARK-CHARITY", "C1-WE-ORIGIN-SEPARATE", "C1-WE-THUMB-WILL", "C1-WE-THUMB-LOGIC"]),
  'held': Object.freeze(["C1-IN-URDHVA-UNBROKEN", "C1-IN-FINGER-FINE", "C1-IN-JOINTS-POPULAR"]),
  'excluded-initial': Object.freeze(["C1-WE-ORIGIN-JOINED", "C1-WE-INDEX-LONG"]),
  'historical-context-only': Object.freeze(["C1-IN-MARK-HISTORICAL-YAVA", "C1-IN-MARK-HISTORICAL-MATSYA", "C1-IN-MARK-HISTORICAL-SHANKHA", "C1-IN-MARK-HISTORICAL-CHATRA", "C1-IN-MARK-HISTORICAL-VEDI"]),
});
