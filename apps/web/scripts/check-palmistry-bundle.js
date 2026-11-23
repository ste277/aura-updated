#!/usr/bin/env node
// AURA-PALM-01-P1 -- post-build guard: while Palmistry content is NOT approved
// by a qualified human reviewer, a production build must contain none of it.
// Fails (exit 1) if any sentinel string from the unapproved content appears in
// the built output. Run after `next build` (CI "Next.js production build" job):
//
//   node scripts/check-palmistry-bundle.js            (from apps/web)
//
// Sentinels are verified to really exist in the source by
// test/palm01I1Content.test.ts, so this check can never pass vacuously.
// They are deliberately ASCII-only: the minifier may emit non-ASCII text as
// escape sequences (e.g. "ñ" -> "\xf1"), which a literal diacritic sentinel
// would silently fail to match (P1 review finding 1).
//
// AURA-PALM-G5-I1-R2/R3/R4 -- IMAGE-INPUT EXCLUSION (runs on every build,
// whatever the content-approval state). What it guarantees, precisely:
//   - Scan roots: .next/static (required), .next/server, .next/standalone and
//     public (optional only when the path is entirely absent; see SCAN_ROOTS).
//   - Every regular file under those roots is read in bounded chunks and
//     matched as bytes against the signature rules below, whatever its name or
//     extension; symlinks are resolved inside the roots and fail closed
//     otherwise; FIFOs, sockets and devices fail closed.
//   - ZIP, GZIP (.tar.gz/.tgz) and TAR (v7/ustar/GNU/pax) archives --
//     recognised by content, including prefixed/suffixed ZIPs -- are inspected
//     entry by entry in memory, nested up to a fixed depth, with every
//     decompression capped on actual output; structures it cannot fully and
//     unambiguously inspect fail closed. Other IDENTIFIABLE archive and
//     compression formats (xz, 7z, bzip2, zstd, lz4, rar, cab, xar, and gzip
//     embedded after offset 0) are not inspected and FAIL CLOSED wherever they
//     occur, top-level or inside an archive (G5-D7-A/D7B; see the archive section).
//   - The OK line states exactly what was inspected (files, bytes, archives,
//     entries, decompressed bytes, roots, absent optional roots).
// What it does NOT guarantee: detection of payloads stored in other
// encodings or in formats WITHOUT a reliable signature (base64/data URLs,
// UTF-16, brotli, raw deflate, lzma "alone", custom obfuscation, renamed
// signature strings) -- detection is signature-based.
// Coverage is of the directories it is run on: the Docker build does not run
// this scanner (open finding R2-N5), and platform post-build packaging (e.g.
// Vercel's own output step) is outside its view.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { isPalmistryApproved } = require('../palmistry-build-exclusion');

const SENTINELS = [
  'zysk-2025', // source-register id
  'palm-line-ayurlekha', // SVG region id
  'PENDING_HUMAN_REVIEW', // review-status value
  'Palmistry is a traditional interpretive practice', // disclosure
  'Learn the lines of the hand', // Explore card copy
  'Aura does not estimate lifespan', // longevity disclosure
  'History of Science in South Asia', // source edition (Zysk 2025)
  'Western palmistry, for comparison', // detail-panel label
];

// AURA-PALM-G5-I1 -- the development-only palm-image input (components/palm-scan,
// lib/palm-analysis, @mediapipe/tasks-vision) is imported only from
// PalmistryView, so the same exclusion removes it. These sentinels prove it.
// Kept separate from SENTINELS (whose source locations
// test/palm01I1Content.test.ts K18 pins); test/palmG5I1PrivacyGate.test.ts
// verifies each one really occurs in the image-input source.
const IMAGE_INPUT_SENTINELS = [
  'palm-dev-assets', // self-hosted MediaPipe asset path
  'Palm image looks suitable for further analysis', // accepted-photo headline
  'g5-i1-dev', // dev gate flag value (compared at runtime, so never minified away)
  'Check a palm photo', // section heading (JSX text)
  'odml.pa.googleapis.com', // MediaPipe bundle (its usage-logger endpoint)
];

// AURA-PALM-G5-I1-R2 (R1-F3) -- signatures of the MediaPipe runtime itself.
// They are string literals inside @mediapipe/tasks-vision 1.2.0 that survive
// minification (a graph name, a WASM-binding property name, two loader and
// graph error messages); test/palmG5I1R2ProductionExclusion.test.ts verifies each one occurs
// in the installed package so this check cannot pass vacuously. They are
// checked separately from IMAGE_INPUT_SENTINELS (which are pinned to Aura's
// own image-input source).
const MEDIAPIPE_SENTINELS = [
  'mediapipe.tasks.vision.hand_landmarker.HandLandmarkerGraph',
  '_mediapipeLoggerGetEncodedApiKey',
  'ModuleFactory not set.',
  'Failed to retrieve CalculatorGraphConfig',
];

// Dev-only MediaPipe runtime/model directory (scripts/palm-dev-assets.js).
// It is gitignored; if it is present in a build tree anyway (e.g. a CLI
// deploy from a developer checkout), the build must fail rather than publish it.
const DEV_ASSET_DIR = 'public/palm-dev-assets';

const SCAN_DIRS = ['.next/static', '.next/server', '.next/standalone'];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (name === 'node_modules') continue;
      yield* walk(full);
    } else if (/\.(js|mjs|cjs|json|html|rsc|txt)$/.test(name)) {
      yield full;
    }
  }
}

// Every file (binary included, node_modules included), symlinks skipped.
// Used only by devAssetsPresent (a name check); content inspection uses
// inspectArtifacts() below, which resolves symlinks.
function* walkAll(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) yield* walkAll(full);
    else yield full;
  }
}

// Configured scan roots (relative to apps/web) and the build-mode contract.
// `next build` (always run before this scanner) creates `.next/static`, so it
// is REQUIRED. The others are OPTIONAL-WHEN-ABSENT: `.next/standalone` exists
// only with `output: 'standalone'`, `public/` is optional in Next.js, and
// `.next/server` is checked when present. "Absent" means the path does not
// exist at all (lstat ENOENT). A root that exists but is a broken symlink, a
// symlink leaving apps/web, a symlink loop, not a directory, or unreadable is
// ALWAYS a blocking scan error -- never treated as absent. Absent optional
// roots are listed in the scanner output.
const SCAN_ROOTS = [
  { rel: '.next/static', required: true },
  { rel: '.next/server', required: false },
  { rel: '.next/standalone', required: false },
  { rel: 'public', required: false },
];
// Back-compatible list of the same roots. These are also the ONLY approved
// targets for symlinks found inside them.
const ARTIFACT_DIRS = SCAN_ROOTS.map((r) => r.rel);

// AURA-PALM-G5-I1-R3/R4 -- content signatures, matched as BYTES in every
// regular file under the scan roots and in every entry of every supported
// archive (see below), whatever its name or extension. Each rule is
// evidence-based (pinned to the installed package / real model by
// test/palmG5I1R3ScannerHardening.test.ts) and specific enough that ordinary
// application assets and prose that merely mentions "MediaPipe" do not match.
//
// WHAT THIS DOES NOT DETECT (documented residual limitation, R3-N2): content
// that is transformed before it is stored -- base64/data URLs, UTF-16,
// arbitrary encodings, encryption, minifier renaming of the signature
// strings, or compression formats other than those listed below. Detection
// is signature-based, not semantic.
const MEDIAPIPE_ARTIFACT_SIGNATURES = [
  'node_modules/@mediapipe/', // package path, e.g. in source-map "sources"
  'hand_landmarks_detector.tflite', // entry name inside hand_landmarker.task
  'hand_detector.tflite', // entry name inside hand_landmarker.task
];
// Header-gated rules: only applied when the file's own leading bytes say
// what it is (so arbitrary binaries are never judged by loose words).
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]); // "\0asm"
const WASM_MEDIAPIPE_MARKERS = ['mediapipe', 'HandLandmarker'];
const TFLITE_IDENTIFIER = Buffer.from('TFL3'); // FlatBuffer file identifier at offset 4

// AURA-PALM-G5-I1-R4/R4.1/R4.2/R4.3 -- supported archive formats, recognised
// by CONTENT (never by file name):
//   - ZIP: any end-of-central-directory record for which a central-directory
//     signature exists where a known reader looks for it -- at
//     (EOCD - directory size) OR at the absolute directory offset (Info-ZIP's
//     "Compensating" fallback, R4.3) -- wherever it sits (prefix, SFX stub or
//     trailing bytes allowed); or (R4.4) any of libarchive's streaming lead
//     signatures at offset 0 (PK\1\2, PK\3\4, PK\5\6, PK\6\6, PK\7\8, "PK00");
//     or an extractable local-file header ANYWHERE (known compressing method,
//     name/extra in bounds; stored headers keep the R4.1 plausibility test,
//     their data being visible to the byte scan -- version byte, name
//     content, CRC and deflate validity are
//     deliberately ignored, because streaming readers scan forward to such a
//     header and write its data before verifying it). Every candidate is
//     parsed strictly; anything incomplete fails closed. Methods: stored (0,
//     never with a data descriptor: R4.4) and deflate (8). The archive at the LAST
//     EOCD must be reachable through the relative location and pass the
//     strict parser (an absolute-only location fails closed). Every other
//     interpretation must lie wholly inside the data of a strictly validated,
//     non-directory entry of that archive (stored or deflated): it is then a
//     nested archive, inspected as that entry's content (R4.2/R4.3); anything
//     else fails closed. Local headers must agree with the central directory (method,
//     flags, CRC, sizes); declared data descriptors must be present and match;
//     every local-header signature outside entry data must be an entry start.
//     Bytes before/after the archive, comments and extra fields are inspected
//     (extra fields > 4 KiB fail closed).
//   - GZIP (incl. .tar.gz/.tgz): parsed member by member (RFC 1952). Every
//     input byte must belong to a member (header, deflate stream, CRC/ISIZE
//     trailer); multi-member streams are decompressed in full; any other
//     trailing data fails closed. FHCRC is verified. FEXTRA, FNAME and
//     FCOMMENT are inspected like entry data (signatures + nested archives).
//     The decompressed stream is byte-scanned; if it is a tar archive its
//     entries are inspected as well.
//   - TAR (uncompressed or inside gzip): recognised by header checksum (with a
//     non-zero first header byte), so v7, ustar, GNU and pax archives are all
//     covered; a header with an empty first byte, or one whose checksum only
//     validates as signed, is not recognised as tar and is byte-scanned only.
//     Every byte is accounted for: headers (unused fields must be zero), entry
//     data, pax records and GNU long-name/long-link payloads (inspected like
//     entry data), padding (must be zero) and the end-of-archive marker
//     (trailing data must be zero).
// R4.2 cross-format rule: the first recognised format only selects the
// parser. Bytes that are BOTH gzip and tar fail closed; any ZIP structure in
// the raw bytes of a gzip or tar container must lie wholly inside a region
// that is itself inspected (tar entry data, gzip header field) or appear
// byte-for-byte in the decompressed output; ZIP signatures in tar header or
// padding bytes fail closed; a ZIP in a container's raw bytes that is reachable
// only through an absolute directory offset (position-dependent, R4.3) fails
// closed. Otherwise the input is ambiguous: fail closed.
// Entries are inspected IN MEMORY (never extracted to disk) with the same
// signature and name rules as plain files; archives inside archives are
// inspected up to INSPECTION_LIMITS.maxNestedArchiveDepth levels.
// Every decompression is hard-capped on ACTUAL output (zlib maxOutputLength,
// set to the declared size, or 1 byte when 0 is declared, and never above the
// remaining budget); the deflate stream must consume exactly the entry's data.
// FAIL-CLOSED (blocking scan error) on: malformed or truncated structures,
// competing ZIP interpretations (several central directories, unreferenced
// local headers), cross-format/polyglot interpretations (R4.2), local/central
// header disagreement, missing or inconsistent data descriptors, a bad gzip
// header CRC, ZIP64, multi-disk, encrypted or password-protected entries,
// unsupported compression methods, CRC or size mismatches, overlapping or
// unreferenced regions, directory entries carrying data, duplicate or unsafe
// entry paths (absolute, "..", backslash, control characters), link/device
// entries, non-zero tar padding or unused header fields, global pax headers,
// pax size/link/sparse overrides, gzip trailing data, nesting beyond the
// depth limit, and any resource-limit violation.
// G5-D7-A -- IDENTIFIABLE BUT NOT INSPECTABLE formats FAIL CLOSED (they are
// never silently skipped): xz, 7z, bzip2, zstd (and, G5-C13, legacy v0.1-0.7
// frames), lz4 (frame and, G5-C13, legacy), rar (v4/v5), cab, (G5-D7B) xar
// and (G5-C15) lzip, ISO 9660 and compress .Z, at offset 0 or EMBEDDED anywhere in an inspected buffer, and a gzip
// stream embedded at offset > 0 (gzip at offset 0 is a supported container,
// above). "Inspected buffer" = every regular file, every archive entry and
// every container region (ZIP prefix/suffix/comments/extra fields, gzip header
// fields, decompressed gzip streams), so archive members are covered too.
// G5-C15 RECOGNITION STRATEGY (one rule per tier, no per-variant exceptions):
//   Tier A -- magic of >= 6 bytes containing non-text bytes (xz, 7z, rar v4/v5,
//     ISO 9660 descriptor "CD001" between a type byte and version 1): the magic
//     ALONE fails closed. Coincidence is ~2^-48 per byte and impossible in
//     text, so no header field is consulted and no header variant can pass.
//   Tier B -- shorter or text-like magic (gzip embedded, bzip2, zstd and its
//     legacy frames, lz4 and its legacy frame, cab, xar, lzip, compress .Z):
//     magic PLUS a structural check that rejects ONLY bytes every supported
//     reader refuses too (bsdtar / libarchive, xz, bzip2, zstd, lz4, gzip,
//     cabextract / libmspack, Node zlib / DecompressionStream). Header fields
//     a reader ignores or tolerates are never validity criteria.
//   Tier C -- no reliable magic (residual R3-N2 below): not detectable.
// Tier B checks per format: the bzip2 block magic with an origin pointer
// bzip2 would accept, the zstd frame and first block header, the lz4 frame
// header checksum (xxh32), the lz4 legacy first block size, the cab folder /
// file counts plus the bsdtar or cabextract header rule, the xar magic with a
// binary header size (or a zlib TOC that inflates at the declared position),
// the lzip version byte (0 or 1), compress .Z (offset 0 only: maxbits 0..16
// and a literal first code), the LHA header size / level bytes (G5-C17), pack,
// gzip LZH and old-magic gzip (offset 0 only, G5-C17), and for embedded gzip a header whose fields are
// scanned up to GZ_FIELD_SCAN plus a bounded deflate probe that counts ANY
// deflate data valid through the probe window, a complete member with a
// matching CRC/ISIZE trailer, or output reaching the probe cap.
// ZIP entries using these compression methods already fail closed
// (unsupported method).
// G5-C11 (C10-F1..F3): a structural check may only reject bytes that a reader
// could not decode either. It must never reject a decodable VARIANT (an
// unsupported check ID, a randomised bzip2 block, an unusual xar version or
// TOC), since that turned real streams into "no archive". Variants fail closed.
// RESIDUAL (not detectable by signature, documented limitation R3-N2):
// formats without a reliable magic number (brotli, raw deflate/zlib, lzma
// "alone", lz4 raw blocks, Snappy), compress .Z EMBEDDED after offset 0 (its
// 2-byte magic cannot be told from coincidental bytes; stock readers only
// read it at offset 0, where it IS detected), ZIP64 (fails closed), and
// payloads that are encoded rather than archived (base64, uuencode, UTF-16,
// custom transforms): see the file header.
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CD_SIG = 0x02014b50;
const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP_DESC_SIG = 0x08074b50;

// Bounded, deterministic inspection limits (CI-safe). Exceeding any of them
// is a blocking scan error, never a silent skip.
const INSPECTION_LIMITS = Object.freeze({
  maxFileBytes: 256 * 1024 * 1024, // one regular file
  maxTotalBytes: 4 * 1024 * 1024 * 1024, // all regular-file bytes read
  maxFiles: 250000, // regular files + archive entries
  maxDepth: 64, // directory depth
  chunkBytes: 1024 * 1024, // regular files are read in chunks of this size
  // Archives (R4/R4.1). An archive file and each decompressed entry are held
  // in memory. Every inflate is capped on actual output, and zlib's sync API
  // may briefly hold the output twice while assembling it, so peak extra
  // memory is bounded by roughly
  // maxArchiveBytes + maxNestedArchiveDepth * 2 * maxArchiveEntryBytes
  // (~448 MiB worst case with the values below; measured far lower in tests).
  maxArchiveBytes: 64 * 1024 * 1024, // compressed size of one archive file
  maxArchiveEntryBytes: 64 * 1024 * 1024, // one decompressed entry / gzip stream
  maxArchiveDecompressedBytes: 256 * 1024 * 1024, // all entries of one top-level archive, nested included
  maxTotalDecompressedBytes: 1024 * 1024 * 1024, // whole scan
  maxCompressionRatio: 200, // applied to entries/streams of >= 1 MiB decompressed
  maxArchiveEntries: 10000, // per archive
  // G5-C11 (C10-F4): members of one gzip stream. Each member keeps a header,
  // an output buffer and possibly header fields in memory, so millions of
  // empty members drove RSS past 2 GiB with no limit tripping. More fails closed.
  maxGzipMembers: 10000,
  maxNestedArchiveDepth: 3, // archive at depth 1 = a file; deeper ones are errors
  maxScanMs: 10 * 60 * 1000, // overall work-time budget
});

function signatureSet() {
  const always = [...IMAGE_INPUT_SENTINELS, ...MEDIAPIPE_SENTINELS, ...MEDIAPIPE_ARTIFACT_SIGNATURES].map((s) => ({ label: s, bytes: Buffer.from(s, 'utf8') }));
  const wasm = WASM_MEDIAPIPE_MARKERS.map((s) => ({ label: `WASM binary with MediaPipe symbol "${s}"`, bytes: Buffer.from(s, 'utf8') }));
  return { always, wasm, maxLen: Math.max(...[...always, ...wasm].map((x) => x.bytes.length)) };
}

/**
 * Search one file's bytes in bounded chunks (overlapping by the longest
 * signature). R4.1: also records where ZIP local-header / end-of-central-
 * directory signatures occur (bounded), so ZIP structures are found wherever
 * they sit in the file, not only at its start or end.
 */
function inspectFileBytes(file, size, sigs, limits) {
  const found = new Set();
  const zipPositions = new Set();
  let zipOverflow = false;
  const foreignPositions = [];
  const foreignSeen = new Set();
  let foreignOverflow = false;
  const zipSigs = [Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from([0x50, 0x4b, 0x05, 0x06])];
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    const headLen = fs.readSync(fd, head, 0, 8, 0);
    const isWasm = headLen >= 4 && head.subarray(0, 4).equals(WASM_MAGIC);
    if (headLen >= 8 && head.subarray(4, 8).equals(TFLITE_IDENTIFIER)) found.add('TFLite model (TFL3 file identifier)');
    const active = isWasm ? [...sigs.always, ...sigs.wasm] : sigs.always;
    const overlap = sigs.maxLen - 1;
    const buf = Buffer.alloc(limits.chunkBytes + overlap);
    let carry = 0;
    let pos = 0;
    while (pos < size) {
      const n = fs.readSync(fd, buf, carry, limits.chunkBytes, pos);
      if (n <= 0) break;
      const view = buf.subarray(0, carry + n);
      const viewStart = pos - carry;
      for (const sig of active) if (!found.has(sig.label) && view.indexOf(sig.bytes) !== -1) found.add(sig.label);
      for (const zs of zipSigs) {
        let i = view.indexOf(zs);
        while (i !== -1) {
          zipPositions.add(viewStart + i);
          if (zipPositions.size > 4096) { zipOverflow = true; break; }
          i = view.indexOf(zs, i + 1);
        }
      }
      // G5-D7-A: magic numbers of identifiable, uninspectable formats (validated later).
      FOREIGN_FORMATS.forEach((fmt, f) => {
        let i = foreignOverflow ? -1 : view.indexOf(fmt.magic);
        while (i !== -1) {
          const key = `${f}:${viewStart + i}`;
          if (!foreignSeen.has(key)) { foreignSeen.add(key); foreignPositions.push({ f, pos: viewStart + i }); }
          if (foreignPositions.length > MAX_SIG_POSITIONS) { foreignOverflow = true; break; }
          i = view.indexOf(fmt.magic, i + 1);
        }
      });
      pos += n;
      carry = Math.min(overlap, view.length);
      view.copy(buf, 0, view.length - carry, view.length);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { labels: [...found], zipPositions: [...zipPositions], zipOverflow, foreignPositions, foreignOverflow };
}

/** For files too large to load: does any recorded ZIP signature position look like a real ZIP structure? */
function largeFileHasPlausibleZip(file, size, positions, overflow) {
  if (overflow) return true;
  const fd = fs.openSync(file, 'r');
  try {
    const lead = Buffer.alloc(Math.min(4, size));
    fs.readSync(fd, lead, 0, lead.length, 0);
    if (hasZipLeadSignature(lead)) return true; // R4.4 (HR2R1-F1): streaming-reader lead signature
    for (const p of positions) {
      const b = Buffer.alloc(Math.min(30 + 4096, size - p));
      fs.readSync(fd, b, 0, b.length, p);
      if (b.length >= 4 && b.readUInt32LE(0) === ZIP_LOCAL_SIG && (p === 0 || extractableLocalHeader(b, 0, size - p))) return true; // R4.2: offset 0 always; R4.4: structural rule elsewhere
      if (b.length >= 22 && b.readUInt32LE(0) === ZIP_EOCD_SIG) {
        const disk = b.readUInt16LE(4), cdDisk = b.readUInt16LE(6), nDisk = b.readUInt16LE(8), nTotal = b.readUInt16LE(10), cdSize = b.readUInt32LE(12);
        if (disk === 0 && cdDisk === 0 && nDisk === nTotal && cdSize <= p) return true;
        // R4.3 (R42-IV-F1): a central-directory signature at either location a reader tries (relative or absolute).
        const cdOffset = b.readUInt32LE(16), sig = Buffer.alloc(4);
        for (const at of [p - cdSize, cdOffset]) if (at >= 0 && at + 4 <= size && fs.readSync(fd, sig, 0, 4, at) === 4 && sig.readUInt32LE(0) === ZIP_CD_SIG) return true;
      }
    }
  } finally { fs.closeSync(fd); }
  return false;
}

/** The same rules as inspectFileBytes, for an in-memory buffer (archive entries). */
function inspectBufferBytes(buf, sigs) {
  const found = new Set();
  const isWasm = buf.length >= 4 && buf.subarray(0, 4).equals(WASM_MAGIC);
  if (buf.length >= 8 && buf.subarray(4, 8).equals(TFLITE_IDENTIFIER)) found.add('TFLite model (TFL3 file identifier)');
  for (const sig of isWasm ? [...sigs.always, ...sigs.wasm] : sigs.always) if (buf.indexOf(sig.bytes) !== -1) found.add(sig.label);
  return [...found];
}

function nameRule(norm, base) {
  if (/(^|\/)@mediapipe(\/|$)/.test(norm)) return 'MediaPipe package file';
  if (/(^|\/)palm-dev-assets(\/|$)/.test(norm)) return 'development-only MediaPipe asset';
  if (/\.task$/i.test(base)) return 'model bundle (.task)';
  if (/vision_wasm|hand_landmarker/i.test(base)) return 'MediaPipe runtime/model file';
  return null;
}

// ------------------------------------------------------------------ archives (R4 + R4.1)
class ArchiveError extends Error {}

const crc32 = (() => {
  if (typeof zlib.crc32 === 'function') return (b) => zlib.crc32(b) >>> 0;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return (b) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
})();

const ZIP_LOCAL_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EOCD_BYTES = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const KNOWN_ZIP_METHODS = new Set([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 14, 18, 19, 93, 94, 95, 96, 97, 98, 99]);
const MAX_ZIP_EXTRA_BYTES = 4096; // per entry (local or central); larger extra fields fail closed
const MAX_SIG_POSITIONS = 4096; // signature occurrences examined per buffer/file before failing closed
// R4.3: central-directory records walked per buffer across ALL structural views (bounds memory and CPU; more fails closed).
const MAX_CD_RECORDS_PER_BUFFER = 100000;

/** All offsets of `needle` in `buf` (bounded). */
function allPositions(buf, needle, from = 0, to = buf.length) {
  const out = [];
  let i = buf.indexOf(needle, from);
  while (i !== -1 && i < to) {
    out.push(i);
    if (out.length > MAX_SIG_POSITIONS) throw new ArchiveError('too many ZIP signature occurrences to inspect safely');
    i = buf.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * R4.4 (HR2R1-F1): libarchive's streaming ZIP reader (bsdtar, from a file or
 * stdin) bids on ANY of these leading signatures -- central-directory, local,
 * EOCD, ZIP64-EOCD, data-descriptor/spanning marker, "PK00" -- and then scans
 * FORWARD to the next local-file header wherever it is. A buffer that starts
 * with one is therefore a ZIP candidate (the strict parser then fails closed
 * unless it is a complete, supported archive).
 */
const ZIP_STREAM_LEAD_SIGS = new Set([0x02014b50, 0x04034b50, 0x06054b50, 0x06064b50, 0x08074b50, 0x30304b50]);
function hasZipLeadSignature(buf) {
  return buf.length >= 4 && ZIP_STREAM_LEAD_SIGS.has(buf.readUInt32LE(0));
}

/**
 * R4.4 (HR2R1-F1; replaces R4.1's "plausible" header test): a local-file
 * header a reader could extract from. STRUCTURAL only -- a known compression
 * method and a name/extra area that fits the available bytes. The version
 * byte and the name's content are NOT consulted (readers ignore them), and
 * neither is the CRC or the deflate stream: streaming readers write data as
 * they decode it (a truncated deflate stream still leaks the payload through
 * bsdtar), so stream or CRC validity is not a safe gate.
 * STORED (method 0) headers keep R4.1's plausibility test (version, a sane
 * non-empty NUL-free name), so R4.4 never recognises fewer candidates than
 * R4.3: stored data is plain bytes of this same buffer, already matched by the
 * byte scan, and any archive inside it is recognised on its own. Not widening
 * the stored case avoids false positives on machine code, where "PK\3\4"
 * followed by a zero method field occurs by chance (a macOS system binary in
 * the R4.4 corpus run). A local header at offset 0 is always a candidate
 * (hasZipLeadSignature), whatever its fields.
 * `available` is the number of bytes from `pos` to the end of the input (for
 * the large-file path, where only a window is read).
 */
function extractableLocalHeader(buf, pos, available = buf.length - pos) {
  if (pos + 30 > buf.length || buf.readUInt32LE(pos) !== ZIP_LOCAL_SIG) return false;
  const method = buf.readUInt16LE(pos + 8);
  if (!KNOWN_ZIP_METHODS.has(method)) return false;
  const nlen = buf.readUInt16LE(pos + 26);
  if (method === 0) {
    if ((buf.readUInt16LE(pos + 4) & 0xff) > 63 || nlen < 1 || nlen > 4096 || pos + 30 + nlen > buf.length) return false;
    return buf.subarray(pos + 30, pos + 30 + nlen).indexOf(0) === -1;
  }
  return 30 + nlen + buf.readUInt16LE(pos + 28) <= available;
}

// ------------------------------------------------------------------ G5-D7-A: identifiable, uninspectable formats
// Probe parameters (not inspection limits): embedded-gzip probes inflate at
// most FOREIGN_PROBE_INPUT input bytes into at most FOREIGN_PROBE_OUTPUT
// output bytes; a stream counts when it decodes to >= FOREIGN_MIN_OUTPUT
// bytes without error. Large files are probed through FOREIGN_WINDOW reads.
const FOREIGN_PROBE_INPUT = 64 * 1024;
const FOREIGN_PROBE_OUTPUT = 64 * 1024;
const FOREIGN_MIN_OUTPUT = 64;
const FOREIGN_WINDOW = 256 * 1024;
// G5-C15 (C14-F1): gzip FNAME / FCOMMENT are scanned for their terminating NUL
// up to this many bytes (readers accept any length). A field still open after
// it, with data beyond, fails closed: real binary data has a NUL long before
// 1 MiB, and text cannot contain the 1F 8B gzip magic (invalid UTF-8).
const GZ_FIELD_SCAN = 1024 * 1024;
// A deflate stream that is valid so far but ends with the available data
// counts once it has at least this many bytes (gunzip emits the partial output).
const GZ_TRUNCATED_MIN = 16;
// A complete member whose trailer does NOT match still counts from this much
// output: the shortest sentinel is 9 bytes, so less cannot hide one, and random
// bytes rarely form a complete deflate stream this long.
const GZ_MIN_LEAK = 8;
// G5-C17 (C16-F1): a candidate the probe would call "not gzip" (invalid or
// truncated deflate) is NOT harmless by that alone: streaming decoders (Node
// createGunzip, DecompressionStream, Python zlib, GNU gzip) emit everything
// decoded before the error. The probe therefore recovers that output with a
// lenient decoder (inflateRecover: symbol by symbol up to the failure, and a
// back-reference "too far back" reads zeros as in GNU gzip, C16-F1b) and
// inspects it like
// any other decoded content: a sentinel, a supported archive or an
// identifiable foreign stream in it fails closed. Random bytes that happen to
// follow a gzip magic decode to garbage that holds none of these, so no
// byte-count threshold (and its false positives) is needed.
const GZ_RECOVER_DEPTH = 3; // nested recovered-output inspections before failing closed
let gzRecoverDepth = 0;
let recoverSigs = null;
// Raw-DEFLATE tables (RFC 1951 3.2.5, 3.2.7).
const DFL_LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const DFL_LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DFL_DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DFL_DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const DFL_CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
function dflHuffman(lengths) {
  const count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(lengths.length);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  let left = 1;
  for (let len = 1; len < 16; len++) { left = left * 2 - count[len]; if (left < 0) throw new Error('over-subscribed code'); }
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}
let DFL_FIXED = null;
/**
 * G5-C17 (C16-F1) lenient raw-DEFLATE decoder used ONLY to recover what a
 * streaming reader emits before a failure: output is produced symbol by
 * symbol and everything decoded before an error, the end of the input or `cap`
 * bytes is returned. It is deliberately a superset of the readers: a copy
 * reaching before the start of the output reads zeros (GNU gzip; zlib refuses
 * it), incomplete codes are allowed, and the rest follows RFC 1951 (stored
 * LEN/NLEN, reserved block type, over-subscribed codes and invalid length /
 * distance symbols end decoding, as in zlib and GNU gzip). zlib's own error
 * path is not used here: a sync zlib call that fails on bad data leaves its
 * engine and output buffers pinned (Node), which repeated probes would turn
 * into unbounded memory.
 */
function inflateRecover(src, cap) {
  const out = Buffer.alloc(cap);
  let n = 0, pos = 0, bitbuf = 0, bitcnt = 0;
  const need = (k) => { while (bitcnt < k) { if (pos >= src.length) throw new Error('end of input'); bitbuf |= src[pos++] << bitcnt; bitcnt += 8; } };
  const bits = (k) => { need(k); const v = bitbuf & ((1 << k) - 1); bitbuf >>>= k; bitcnt -= k; return v; };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('invalid code');
  };
  const emit = (b) => { if (n >= cap) throw new Error('cap'); out[n++] = b; };
  try {
    let last = 0;
    while (!last) {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitbuf = 0; bitcnt = 0;
        if (pos + 4 > src.length) throw new Error('end of input');
        const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8);
        if (len !== (~nlen & 0xffff)) throw new Error('stored length mismatch');
        pos += 4;
        for (let i = 0; i < len; i++) { if (pos >= src.length) throw new Error('end of input'); emit(src[pos++]); }
        continue;
      }
      let lit, dist;
      if (type === 1) {
        if (!DFL_FIXED) { const l = new Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288); DFL_FIXED = { lit: dflHuffman(l), dist: dflHuffman(new Array(30).fill(5)) }; }
        ({ lit, dist } = DFL_FIXED);
      } else if (type === 2) {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw new Error('bad counts');
        const cl = new Array(19).fill(0);
        for (let i = 0; i < ncode; i++) cl[DFL_CL_ORDER[i]] = bits(3);
        const clh = dflHuffman(cl);
        const lens = [];
        while (lens.length < nlen + ndist) {
          const sym = decode(clh);
          if (sym < 16) { lens.push(sym); continue; }
          let rep, val = 0;
          if (sym === 16) { if (!lens.length) throw new Error('repeat with no length'); val = lens[lens.length - 1]; rep = 3 + bits(2); } else if (sym === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
          if (lens.length + rep > nlen + ndist) throw new Error('too many lengths');
          while (rep--) lens.push(val);
        }
        if (!lens[256]) throw new Error('no end-of-block code');
        lit = dflHuffman(lens.slice(0, nlen)); dist = dflHuffman(lens.slice(nlen));
      } else throw new Error('reserved block type');
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) { emit(sym); continue; }
        if (sym === 256) break;
        const li = sym - 257;
        if (li >= 29) throw new Error('invalid length symbol');
        const len = DFL_LEN_BASE[li] + bits(DFL_LEN_EXTRA[li]);
        const ds = decode(dist);
        if (ds >= 30) throw new Error('invalid distance symbol');
        const d = DFL_DIST_BASE[ds] + bits(DFL_DIST_EXTRA[ds]);
        for (let i = 0; i < len; i++) emit(n - d >= 0 ? out[n - d] : 0);
      }
    }
  } catch { /* everything decoded so far is what a streaming reader may emit */ }
  return out.subarray(0, n);
}
/** Output a streaming decoder could emit before `slice` fails, or 'cap' at the probe output cap. */
function recoverDeflate(slice) {
  const out = inflateRecover(slice, FOREIGN_PROBE_OUTPUT + 1);
  return out.length > FOREIGN_PROBE_OUTPUT ? 'cap' : out;
}
/** Does output a reader would recover hold anything the scanner must not let through? */
function recoveredOutputLeaks(out) {
  if (out === 'cap') return true;
  if (!out || out.length === 0) return false;
  if (!recoverSigs) { const s = signatureSet(); recoverSigs = { ...s, always: [...s.always, ...SENTINELS.map((x) => ({ label: x, bytes: Buffer.from(x, 'utf8') }))] }; }
  if (inspectBufferBytes(out, recoverSigs).length > 0) return true;
  if (gzRecoverDepth >= GZ_RECOVER_DEPTH) return out.length >= GZ_MIN_LEAK; // nesting bound: fail closed
  gzRecoverDepth++;
  try { return detectArchiveInBuffer(out) !== null || findForeignStream(out) !== null; } finally { gzRecoverDepth--; }
}
/** The probe found no gzip: fail closed anyway when the output readers WOULD recover leaks. */
function gzipRecoverableLeak(slice) {
  return recoveredOutputLeaks(recoverDeflate(slice));
}

/** xxHash32 (lz4 frame header checksum). */
function xxh32(b, seed = 0) {
  const P1 = 2654435761, P2 = 2246822519, P3 = 3266489917, P4 = 668265263, P5 = 374761393;
  const rotl = (x, r) => ((x << r) | (x >>> (32 - r))) >>> 0;
  const mul = (x, y) => Math.imul(x, y) >>> 0;
  const n = b.length;
  let i = 0, h;
  if (n >= 16) {
    let v1 = (seed + P1 + P2) >>> 0, v2 = (seed + P2) >>> 0, v3 = seed >>> 0, v4 = (seed - P1) >>> 0;
    const round = (v, x) => mul(rotl((v + mul(x, P2)) >>> 0, 13), P1);
    for (; i + 16 <= n; i += 16) { v1 = round(v1, b.readUInt32LE(i)); v2 = round(v2, b.readUInt32LE(i + 4)); v3 = round(v3, b.readUInt32LE(i + 8)); v4 = round(v4, b.readUInt32LE(i + 12)); }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else h = (seed + P5) >>> 0;
  h = (h + n) >>> 0;
  for (; i + 4 <= n; i += 4) h = mul(rotl((h + mul(b.readUInt32LE(i), P3)) >>> 0, 17), P4);
  for (; i < n; i++) h = mul(rotl((h + mul(b[i], P5)) >>> 0, 11), P1);
  h = mul(h ^ (h >>> 15), P2); h = mul(h ^ (h >>> 13), P3);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Embedded gzip member (Tier B). `ctx.more`: the buffer is a window and the
 * input continues past its end (large-file path).
 * G5-C15 (C14-F1): the header no longer rejects reserved flag bits (Apple and
 * Python gzip decode them), FNAME / FCOMMENT are scanned up to GZ_FIELD_SCAN
 * instead of 64 KiB, and the deflate probe (at most FOREIGN_PROBE_INPUT input,
 * FOREIGN_PROBE_OUTPUT output) counts:
 *   - output reaching FOREIGN_MIN_OUTPUT or the probe cap (as before);
 *   - a COMPLETE deflate stream followed by a matching CRC32/ISIZE trailer,
 *     whatever its output size (chains of tiny members);
 *   - deflate data valid through the whole probe window, or to the end of the
 *     available data after >= GZ_TRUNCATED_MIN bytes (e.g. > 64 KiB of empty
 *     stored blocks before the content; a truncated stream).
 * Otherwise (invalid deflate data, a short truncated stream, a tiny member
 * with a wrong trailer) G5-C17 (C16-F1) inspects the output readers recover
 * before the failure (gzipRecoverableLeak). Work stays bounded per candidate.
 */
function validGzipAt(buf, p, ctx = {}) {
  if (p + 10 > buf.length || buf[p + 2] !== 8) return false;
  const flg = buf[p + 3];
  let q = p + 10;
  if (flg & 0x04) { if (q + 2 > buf.length) return !!ctx.more; q += 2 + buf.readUInt16LE(q); }
  for (const bit of [0x08, 0x10]) if (flg & bit) {
    const end = Math.min(buf.length, q + GZ_FIELD_SCAN);
    const z = q < end ? buf.subarray(q, end).indexOf(0) : -1;
    if (z === -1) return end < buf.length || !!ctx.more; // field longer than the scan bound, data beyond it: fail closed
    q += z + 1;
  }
  if (flg & 0x02) q += 2;
  if (q >= buf.length) return !!ctx.more;
  const slice = buf.subarray(q, q + FOREIGN_PROBE_INPUT);
  let r;
  try { r = zlib.inflateRawSync(slice, { maxOutputLength: FOREIGN_PROBE_OUTPUT, info: true }); } catch (err) {
    if (err && err.code === 'ERR_BUFFER_TOO_LARGE') return true; // probe output cap reached
    if (err && err.code === 'Z_BUF_ERROR' && (slice.length === FOREIGN_PROBE_INPUT || !!ctx.more || slice.length >= GZ_TRUNCATED_MIN)) return true; // valid deflate up to the end of the window / data
    return gzipRecoverableLeak(slice); // G5-C17 (C16-F1): invalid or short truncated deflate -- inspect what readers emit before failing
  }
  if (r.buffer.length >= FOREIGN_MIN_OUTPUT) return true;
  // A complete member: gunzip and DecompressionStream emit its output BEFORE
  // checking the trailer, so it counts if the trailer matches (tiny-member
  // chains) or if its output could hold a sentinel (>= GZ_MIN_LEAK bytes)
  // whatever the trailer says.
  if (r.buffer.length >= GZ_MIN_LEAK) return true;
  const t = q + r.engine.bytesWritten;
  if (t + 8 > buf.length) return !!ctx.more || gzipRecoverableLeak(slice);
  return (buf.readUInt32LE(t) === crc32(r.buffer) && buf.readUInt32LE(t + 4) === r.buffer.length) || gzipRecoverableLeak(slice);
}
/**
 * xz stream header (G5-C15: Tier A -- the magic alone; history below).
 * G5-C11 (C10-F2): the flag VALUES are not consulted. xz decodes check IDs it
 * does not support (2, 3, 5-9, 11-15) with only a warning, so accepting only
 * the known IDs turned those streams into "no archive". Any stream header whose
 * CRC matches now fails closed, whatever its check ID or reserved bits
 * (unsupported variants are rejected, never passed). The CRC stays: xz itself
 * refuses a header whose CRC is wrong, and it keeps coincidental magic bytes
 * from matching.
 */
function validXzAt() {
  return true; // G5-C15 Tier A: the 6-byte binary magic alone fails closed (no header field, not even the CRC, is consulted)
}
/**
 * 7z signature header (G5-C15: Tier A -- the magic alone; history below).
 * G5-C13 (C12-F2): the major-version byte is no longer consulted. The CRC
 * does not cover it and bsdtar extracts archives with a major version of 1 or
 * 0xff, so a version check turned decodable archives into "no archive". The
 * CRC stays: bsdtar refuses a start header whose CRC is wrong.
 */
function valid7zAt() {
  return true; // G5-C15 Tier A: the 6-byte binary magic alone fails closed (C14-P3-1: 7-Zip may recover a zeroed or bad start header)
}
/**
 * bzip2: "BZh" + level byte + block magic (searched) + origin pointer below the block size.
 * G5-C11 (C10-F3): the randomised bit is no longer consulted. bzip2 still
 * decodes randomised blocks, so rejecting them turned decodable streams into
 * "no archive". An out-of-range level digit no longer rejects either: it is
 * bounded as level 9 (fail closed on the unsupported variant). The origin
 * pointer bound stays because bzip2 itself refuses a block whose pointer is
 * not inside the block (BZ_DATA_ERROR), so it rejects only undecodable bytes,
 * and it is what keeps a "BZh91AY&SY" constant in JS text from matching.
 */
function validBzip2At(buf, p) {
  if (p < 0 || p + 18 > buf.length || buf.toString('latin1', p, p + 3) !== 'BZh') return false;
  const digit = buf[p + 3] - 0x30;
  const level = digit >= 1 && digit <= 9 ? digit : 9;
  const origPtr = ((buf[p + 14] & 0x7f) << 17) | (buf[p + 15] << 9) | (buf[p + 16] << 1) | (buf[p + 17] >>> 7);
  return origPtr < level * 100000;
}
/** zstd frame: frame header descriptor (reserved bit zero, sane window) and a valid first block header. */
function validZstdAt(buf, p) {
  if (p + 6 > buf.length) return false;
  const fhd = buf[p + 4];
  if (fhd & 0x08) return false;
  const single = (fhd >> 5) & 1;
  if (!single && buf[p + 5] >> 3 > 21) return false; // window log > 31
  const hdr = 1 + (single ? 0 : 1) + [0, 1, 2, 4][fhd & 3] + [single, 2, 4, 8][fhd >> 6];
  const b = p + 4 + hdr;
  if (b + 3 > buf.length) return false;
  const bh = buf.readUIntLE(b, 3), type = (bh >> 1) & 3, size = bh >>> 3;
  if (type === 3 || size > 128 * 1024) return false;
  return b + 3 + (type === 1 ? 1 : size) <= buf.length;
}
/** lz4 frame: FLG/BD fields and the descriptor checksum (second byte of xxh32). */
function validLz4At(buf, p) {
  if (p + 7 > buf.length) return false;
  const flg = buf[p + 4], bd = buf[p + 5];
  if (flg >> 6 !== 1 || flg & 0x02 || bd & 0x8f || ((bd >> 4) & 7) < 4) return false;
  const dlen = 2 + (flg & 0x08 ? 8 : 0) + (flg & 0x01 ? 4 : 0);
  if (p + 4 + dlen + 1 > buf.length) return false;
  return ((xxh32(buf.subarray(p + 4, p + 4 + dlen)) >>> 8) & 0xff) === buf[p + 4 + dlen];
}
/**
 * G5-C13 (C12-F4): lz4 LEGACY frame (`lz4 -l`): magic 02 21 4C 18, then
 * blocks prefixed by a 32-bit compressed size. `lz4 -dc` decodes it, so it
 * fails closed like the lz4 frame format. Structural check: the first block
 * size is 1..LZ4_compressBound(8 MiB), the most the legacy format allows.
 */
const LZ4_LEGACY_MAX_BLOCK = 8 * 1024 * 1024 + Math.floor((8 * 1024 * 1024) / 255) + 16;
function validLz4LegacyAt(buf, p) {
  if (p + 8 > buf.length) return false;
  const n = buf.readUInt32LE(p + 4);
  return n >= 1 && n <= LZ4_LEGACY_MAX_BLOCK;
}
/**
 * G5-C13 (C12-F5): zstd LEGACY frames (format versions 0.1-0.7; magics
 * 1E/22..27 B5 2F FD). The zstd CLI still decodes legacy frames (v0.7 shown;
 * which versions depends on how it was built), so every legacy magic fails
 * closed; the 4-byte magic and one following byte are the whole check.
 */
function validZstdLegacyAt(buf, p) {
  return p + 5 <= buf.length;
}
/**
 * G5-D7B (IV3B-1) xar (macOS .pkg container): big-endian header -- size
 * 28..4096, version 1, non-zero TOC lengths -- followed by a zlib TOC that
 * really inflates (bounded) to XML.
 * G5-IV3F: the checksum id is NOT checked (IV3E-2: 7-Zip extracts xar whatever
 * its checksum id, 0..0xFFFFFFFF), and a TOC whose bounded probe reaches the
 * inspection cap counts as detected (IV3E-1: a large XML comment or whitespace
 * in the TOC must not turn the archive into "no archive").
 * G5-C11 (C10-F1): recognised from the magic and the header-size field alone.
 * The version, the TOC lengths and the TOC content are no longer consulted:
 * xar extracts version-2 headers, a zero or > 2^31 uncompressed TOC length,
 * and TOCs that begin with a comment, a BOM, a DOCTYPE or a processing
 * instruction, all of which the old checks passed as "no archive". Rule:
 *   (a) "xar!" + a binary header size 0..4096 -> xar (any variant fails
 *       closed; G5-C13 / C12-F1: xar reads the TOC at offset 28 even when
 *       the field says less, so sizes below 28 count too). Text after "xar!"
 *       is printable (>= 0x20 0x20 = 8224), so this range does not match
 *       ordinary prose or code;
 *   (b) any other header size -> xar if a zlib stream at the declared TOC
 *       position really inflates (bounded), as a reader would find it.
 */
function validXarAt(buf, p) {
  if (p + 8 > buf.length) return false;
  const hsize = buf.readUInt16BE(p + 4);
  if (hsize <= 4096) return true; // G5-C13 (C12-F1): sizes below 28 too -- xar reads the TOC at 28 whatever the field says
  const t = p + hsize;
  if (hsize < 8 || t + 2 > buf.length) return false;
  try {
    return zlib.inflateSync(buf.subarray(t, t + 4096), { maxOutputLength: FOREIGN_PROBE_OUTPUT, finishFlush: zlib.constants.Z_SYNC_FLUSH }).length >= FOREIGN_MIN_OUTPUT;
  } catch (err) { return !!err && err.code === 'ERR_BUFFER_TOO_LARGE'; } // IV3E-1: xar TOC probe reached the inspection cap -> detected
}
/**
 * rar v4 / v5 (G5-C15, Tier A): the marker "Rar!\x1a\x07" alone fails closed.
 * C12-F6 / C14-F2 / C14-F3 showed bsdtar reads archives whatever block comes
 * first (main, comment, add-size AV / SUB / PROTECT / SIGN blocks, a v5 file
 * or service header) and with 4-byte v5 header-size numbers; block-order and
 * CRC checks kept turning decodable archives into "no archive". The 6-byte
 * marker holds two control bytes, so it cannot occur in text.
 */
function validRarAt() {
  return true;
}
/**
 * cab: first reserved field zero, at least one folder and one file.
 * G5-C13 (C12-F3): the second and third reserved fields, the version, the
 * cabinet size and the file-table offset are no longer consulted. bsdtar
 * extracts cabinets where any of them is unusual, so those checks turned
 * decodable cabinets into "no archive". The remaining checks are the ones
 * bsdtar itself enforces (it refuses reserved1 != 0, zero folders or zero
 * files); they also keep "MSCF" in text from matching.
 */
function validCabAt(buf, p, ctx = {}) {
  if (p + 36 > buf.length) return false;
  if (buf.readUInt16LE(p + 26) < 1 || buf.readUInt16LE(p + 28) < 1) return false; // no folder or no file: bsdtar and cabextract both refuse
  if (buf.readUInt32LE(p + 4) === 0) return true; // bsdtar's rule
  // G5-C15 (C14-P3-1): cabextract (libmspack) ignores reserved1. Its search
  // accepts a cabinet whose file-table offset lies below the cabinet size and
  // whose size fits the input (+32). Text after "MSCF" gives a size of at
  // least 0x20202020 (538 MB), beyond any inspected input, so text still passes.
  const avail = ctx.total ?? buf.length - p;
  return buf.readUInt32LE(p + 16) < buf.readUInt32LE(p + 8) && buf.readUInt32LE(p + 8) < avail + 32;
}
/**
 * G5-C15 (C14-F4) lzip (Tier B): "LZIP" + version 0 or 1 (xz 5.4+, lzip
 * and bsdtar refuse other versions) + a first LZMA byte of 0x00 (the range
 * coder always starts with it; xz refuses anything else as corrupt). The
 * dictionary-size byte is not consulted. The 0x00 rule keeps NUL-terminated
 * "LZIP" strings (e.g. a translated MIME-type table) from matching.
 */
function validLzipAt(buf, p) {
  return p + 7 <= buf.length && (buf[p + 4] === 0 || buf[p + 4] === 1) && buf[p + 6] === 0;
}
/**
 * G5-C15 (C14-F4) ISO 9660 / zisofs (Tier A): a volume descriptor -- type byte
 * 0..3 or 255, "CD001", version 1. bsdtar extracts ISO images, decompressing
 * zisofs files on the fly, so any descriptor fails closed (shift -1: the type
 * byte precedes the searched "CD001"). Text cannot match: both bytes around
 * "CD001" are control bytes.
 */
function validIsoAt(buf, p) {
  return p + 7 <= buf.length && (buf[p] <= 3 || buf[p] === 0xff) && buf[p + 6] === 1;
}
/**
 * G5-C15 (C14-F4) compress .Z (Tier B), checked at OFFSET 0 of every inspected
 * buffer only, where gzip, uncompress and bsdtar read it (they ignore a .Z
 * that starts later; see RESIDUAL). Rule: 1F 9D, maxbits 0..16 and a first
 * 9-bit code below 256 (every reader: "corrupt input" otherwise). C15-CI-1:
 * the maxbits range is the UNION of the readers: GNU gzip 1.12 (and its
 * uncompress) decodes maxbits 0..16 (it refuses only > 16), Apple gzip
 * 12..16. The block-mode and reserved flag bits are ignored by GNU gzip.
 */
function validCompressAt(buf) {
  if (buf.length < 5 || buf[0] !== 0x1f || buf[1] !== 0x9d) return false;
  const maxbits = buf[2] & 0x1f;
  return maxbits <= 16 && (buf[3] | ((buf[4] & 1) << 8)) < 256;
}
/**
 * G5-C17 (C16-F2) LHA / LArc header (Tier B), found by its method tag at
 * offset 2 of the header, anywhere in the buffer (libarchive also finds an
 * archive behind a self-extractor stub). bsdtar (libarchive) extracts level-0
 * headers whatever the attribute byte; the rule keeps only what a reader needs
 * to see a header: a non-zero header size byte, a method tag libarchive knows
 * (-lh0-..-lh7-, -lhd-, -lzs-, -lz4-, -lz5-) and a header level 0..3. Attribute
 * and checksums are not criteria (readers differ on them). Text cannot match:
 * the level byte must be a control byte 0..3.
 */
function validLhaAt(buf, p) {
  return p + 22 <= buf.length && buf[p] !== 0 && buf[p + 20] <= 3;
}
/**
 * G5-C17 (C16-F3, C17-N1) single-stream formats GNU / Apple gzip decode at
 * OFFSET 0 only (they refuse them after a prefix; a gzip member followed by
 * one already fails closed as unexpected data after the member):
 *   pack   1F 1E + 4-byte length + tree depth (gzip: header of 7 bytes)
 *   LZH    1F A0 (SCO compress -H, GNU gzip only) + at least one data byte pair
 *   gzip with the old magic 1F 9E (both gzips treat it as 1F 8B): method 8
 *          and a complete 10-byte header. The scanner does not inflate it.
 * No field beyond these is a criterion: any such header fails closed.
 */
function validPackAt(buf) { return buf.length >= 7 && buf[0] === 0x1f && buf[1] === 0x1e; }
function validGzipLzhAt(buf) { return buf.length >= 4 && buf[0] === 0x1f && buf[1] === 0xa0; }
function validOldGzipAt(buf) { return buf.length >= 10 && buf[0] === 0x1f && buf[1] === 0x9e && buf[2] === 8; }
/** Format of an offset-0-only stream at the start of `buf`, or null. */
function headForeignFormat(buf) {
  if (validCompressAt(buf)) return 'compress (.Z)'; // G5-C15 (C14-F4)
  if (validPackAt(buf)) return 'pack (1F 1E)';
  if (validGzipLzhAt(buf)) return 'gzip LZH (1F A0)';
  if (validOldGzipAt(buf)) return 'gzip (old magic 1F 9E)';
  return null;
}
// `shift`: offset of the stream start relative to the searched magic.
const FOREIGN_FORMATS = [
  { name: 'gzip (embedded)', magic: Buffer.from([0x1f, 0x8b, 0x08]), validate: validGzipAt },
  { name: 'xz', magic: Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]), validate: validXzAt },
  { name: '7z', magic: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), validate: valid7zAt },
  { name: 'bzip2', magic: Buffer.from([0x31, 0x41, 0x59, 0x26, 0x53, 0x59]), shift: -4, validate: validBzip2At },
  { name: 'zstd', magic: Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), validate: validZstdAt },
  { name: 'lz4', magic: Buffer.from([0x04, 0x22, 0x4d, 0x18]), validate: validLz4At },
  { name: 'lz4 (legacy)', magic: Buffer.from([0x02, 0x21, 0x4c, 0x18]), validate: validLz4LegacyAt }, // G5-C13 (C12-F4)
  ...[0x1e, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27].map((v) => ({ name: `zstd (legacy v0.${v === 0x1e ? 1 : v - 0x20})`, magic: Buffer.from([v, 0xb5, 0x2f, 0xfd]), validate: validZstdLegacyAt })), // G5-C13 (C12-F5)
  { name: 'rar', magic: Buffer.from('Rar!\x1a\x07', 'latin1'), validate: validRarAt },
  { name: 'cab', magic: Buffer.from('MSCF', 'latin1'), validate: validCabAt },
  { name: 'xar', magic: Buffer.from('xar!', 'latin1'), validate: validXarAt },
  { name: 'lzip', magic: Buffer.from('LZIP', 'latin1'), validate: validLzipAt }, // G5-C15 (C14-F4)
  { name: 'iso9660', magic: Buffer.from('CD001', 'latin1'), shift: -1, validate: validIsoAt }, // G5-C15 (C14-F4)
  ...['-lh0-', '-lh1-', '-lh2-', '-lh3-', '-lh4-', '-lh5-', '-lh6-', '-lh7-', '-lhd-', '-lzs-', '-lz4-', '-lz5-'].map((m) => ({ name: 'lha', magic: Buffer.from(m, 'latin1'), shift: -2, validate: validLhaAt })), // G5-C17 (C16-F2)
];

/**
 * G5-D7-A: first identifiable stream of a format the scanner cannot inspect,
 * or null. Called only for buffers that are NOT a supported archive (so gzip
 * at offset 0 never reaches it). Bounded: more than MAX_SIG_POSITIONS
 * occurrences of one magic fails closed.
 */
function findForeignStream(buf) {
  const head = headForeignFormat(buf); // G5-C15 (C14-F4) / G5-C17 (C16-F3, C17-N1): offset 0 only
  if (head) return { format: head, pos: 0 };
  for (const f of FOREIGN_FORMATS) {
    let i = buf.indexOf(f.magic);
    let n = 0;
    while (i !== -1) {
      if (++n > MAX_SIG_POSITIONS) throw new ArchiveError(`too many ${f.name} signature occurrences to inspect safely`);
      const p = i + (f.shift || 0);
      if (p >= 0 && f.validate(buf, p, { more: false, total: buf.length - p })) return { format: f.name, pos: p };
      i = buf.indexOf(f.magic, i + 1);
    }
  }
  return null;
}
function assertNoForeignStream(buf, label) {
  const f = findForeignStream(buf);
  if (f) throw new ArchiveError(`unsupported archive or compressed stream (${f.format}) at offset ${f.pos} of "${label}" cannot be inspected (identifiable formats fail closed)`);
}
/** Large files: validate recorded magic positions through bounded window reads. */
function largeFileForeignStream(file, size, positions) {
  const fd = fs.openSync(file, 'r');
  try {
    for (const { f, pos } of positions) {
      const fmt = FOREIGN_FORMATS[f];
      const p = pos + (fmt.shift || 0);
      if (p < 0) continue;
      const w = Buffer.alloc(Math.min(FOREIGN_WINDOW, size - p));
      fs.readSync(fd, w, 0, w.length, p);
      if (fmt.validate(w, 0, { more: size - p > w.length, total: size - p })) return { format: fmt.name, pos: p };
    }
  } finally { fs.closeSync(fd); }
  return null;
}

/** Entry paths are untrusted metadata: only ever displayed, never used to touch the filesystem. */
function checkEntryPath(name) {
  if (name.length === 0) throw new ArchiveError('empty entry path');
  if (/[\x00-\x1f\x7f]/.test(name)) throw new ArchiveError('unsafe entry path (control characters)');
  if (name.includes('\\')) throw new ArchiveError('unsafe entry path (backslash)');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw new ArchiveError('unsafe entry path (absolute)');
  if (name.split('/').includes('..')) throw new ArchiveError('unsafe entry path (".." traversal)');
}

/**
 * R4.1 bounded raw inflate. `cap` is a hard limit on ACTUAL output bytes
 * (zlib aborts as soon as it is exceeded; nothing is allocated from
 * metadata). Returns the output and the exact number of input bytes the
 * deflate stream consumed, so callers can account for every input byte.
 */
function inflateRawBounded(input, cap, label) {
  if (input.length === 0) throw new ArchiveError(`empty deflate stream for "${label}"`);
  let r;
  try { r = zlib.inflateRawSync(input, { maxOutputLength: Math.max(1, cap), info: true }); } catch (err) {
    if (err && err.code === 'ERR_BUFFER_TOO_LARGE') throw new ArchiveError(`decompressed output exceeds its limit (${cap} bytes) for "${label}"`);
    throw new ArchiveError(`decompression error (corrupt or truncated deflate data) for "${label}" (${err.code || err.message})`);
  }
  return { out: r.buffer, consumed: r.engine.bytesWritten };
}

/** Parse the central directory that belongs to the EOCD record at `eocd` (trailing bytes after it are allowed). */
function parseZipCentralDirectory(buf, eocd, limits) {
  if (eocd + 22 > buf.length) throw new ArchiveError('malformed ZIP (end-of-central-directory record truncated)');
  const commentLen = buf.readUInt16LE(eocd + 20);
  const eocdEnd = eocd + 22 + commentLen;
  if (eocdEnd > buf.length) throw new ArchiveError('malformed ZIP (archive comment truncated)');
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) throw new ArchiveError('ZIP64 archives are not supported');
  const disk = buf.readUInt16LE(eocd + 4), cdDisk = buf.readUInt16LE(eocd + 6);
  const nDisk = buf.readUInt16LE(eocd + 8), nTotal = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || nDisk !== nTotal) throw new ArchiveError('multi-disk ZIP archives are not supported');
  if (nTotal === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ArchiveError('ZIP64 archives are not supported');
  if (nTotal > limits.maxArchiveEntries) throw new ArchiveError(`archive entry-count limit (${limits.maxArchiveEntries}) exceeded`);
  const cdStart = eocd - cdSize;
  const delta = cdStart - cdOffset; // bytes prepended before the archive (e.g. hand_landmarker.task, SFX stubs)
  if (cdStart < 0 || delta < 0) throw new ArchiveError('malformed ZIP (central directory out of range)');
  const entries = [];
  const meta = [];
  const names = new Set();
  let p = cdStart;
  for (let i = 0; i < nTotal; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== ZIP_CD_SIG) throw new ArchiveError('malformed ZIP (bad central-directory entry)');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38), lho = buf.readUInt32LE(p + 42);
    if (p + 46 + nlen + elen + clen > eocd) throw new ArchiveError('malformed ZIP (central-directory entry overruns)');
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (elen > MAX_ZIP_EXTRA_BYTES) throw new ArchiveError(`oversized ZIP extra field (${elen} bytes) for "${name}"`);
    if (elen) meta.push({ label: `<central extra of ${name}>`, data: buf.subarray(p + 46 + nlen, p + 46 + nlen + elen) });
    if (clen) meta.push({ label: `<comment of ${name}>`, data: buf.subarray(p + 46 + nlen + elen, p + 46 + nlen + elen + clen) });
    p += 46 + nlen + elen + clen;
    checkEntryPath(name);
    if (names.has(name)) throw new ArchiveError(`duplicate entry path "${name}"`);
    names.add(name);
    if (flags & 0x1 || flags & 0x40 || method === 99) throw new ArchiveError(`encrypted or password-protected entry "${name}"`);
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new ArchiveError('ZIP64 entries are not supported');
    const unixType = (extAttr >>> 16) & 0o170000;
    if (unixType === 0o120000) throw new ArchiveError(`link entry "${name}" is not supported`);
    if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) throw new ArchiveError(`special entry "${name}" is not supported`);
    if (method !== 0 && method !== 8) throw new ArchiveError(`unsupported compression method ${method} for "${name}"`);
    // R4.4 (HR2R1-F2): a STORED entry has no self-delimiting stream, so for a
    // declared data descriptor a streaming reader finds the end of the data by
    // SEARCHING it for a descriptor signature. An early fake descriptor then
    // ends the entry and exposes whatever follows as a new local header -- an
    // interpretation the central directory never shows. Fail closed.
    if (method === 0 && flags & 0x8) throw new ArchiveError(`stored entry with a data descriptor "${name}" is not supported (streaming readers locate its end by searching the data; ambiguous)`);
    const lh = lho + delta;
    if (lh + 30 > cdStart || buf.readUInt32LE(lh) !== ZIP_LOCAL_SIG) throw new ArchiveError(`malformed ZIP (bad local header for "${name}")`);
    const lnlen = buf.readUInt16LE(lh + 26), lelen = buf.readUInt16LE(lh + 28);
    if (buf.toString('utf8', lh + 30, lh + 30 + lnlen) !== name) throw new ArchiveError(`entry path mismatch between local header and central directory ("${name}")`);
    if (lelen > MAX_ZIP_EXTRA_BYTES) throw new ArchiveError(`oversized ZIP extra field (${lelen} bytes) for "${name}"`);
    if (lelen) meta.push({ label: `<local extra of ${name}>`, data: buf.subarray(lh + 30 + lnlen, lh + 30 + lnlen + lelen) });
    const dataStart = lh + 30 + lnlen + lelen;
    const dataEnd = dataStart + csize;
    if (dataEnd > cdStart) throw new ArchiveError(`truncated ZIP entry "${name}"`);
    // R4.2 (IV1-F2): streaming readers trust the LOCAL header, so its fields
    // must agree with the central directory (one interpretation per entry).
    const lflags = buf.readUInt16LE(lh + 6), lmethod = buf.readUInt16LE(lh + 8);
    const lcrc = buf.readUInt32LE(lh + 14), lcsize = buf.readUInt32LE(lh + 18), lusize = buf.readUInt32LE(lh + 22);
    if (lmethod !== method || ((lflags ^ flags) & 0x49) !== 0) throw new ArchiveError(`local header disagrees with central directory (method/flags) for "${name}"`);
    if (flags & 0x8) {
      if ((lcrc !== 0 && lcrc !== crc) || (lcsize !== 0 && lcsize !== csize) || (lusize !== 0 && lusize !== usize)) throw new ArchiveError(`local header disagrees with central directory (CRC/sizes) for "${name}"`);
    } else if (lcrc !== crc || lcsize !== csize || lusize !== usize) throw new ArchiveError(`local header disagrees with central directory (CRC/sizes) for "${name}"`);
    // R4.2 (IV1-F2): a declared data descriptor must be present and must match
    // the central directory exactly (optional signature + CRC + sizes).
    let end = dataEnd;
    if (flags & 0x8) {
      const hasSig = dataEnd + 4 <= cdStart && buf.readUInt32LE(dataEnd) === ZIP_DESC_SIG;
      const d = dataEnd + (hasSig ? 4 : 0);
      if (d + 12 > cdStart || buf.readUInt32LE(d) !== crc || buf.readUInt32LE(d + 4) !== csize || buf.readUInt32LE(d + 8) !== usize) throw new ArchiveError(`missing or inconsistent data descriptor for "${name}"`);
      end = d + 12;
    }
    const isDir = name.endsWith('/') || unixType === 0o040000;
    entries.push({ name, method, flags, crc, csize, usize, dataStart, dataEnd, end, start: lh, isDir });
  }
  if (p !== eocd) throw new ArchiveError('malformed ZIP (central-directory size mismatch)');
  if (commentLen) meta.push({ label: '<archive comment>', data: buf.subarray(eocd + 22, eocdEnd) });
  return { entries, meta, cdStart, eocd, eocdEnd };
}

/**
 * R4.2 (IV1-F1/F2/F3) + R4.3 (R42-IV-F1): STRUCTURAL views of the ZIP(s) that
 * a stock reader could see from the EOCD record at `eocd`. Deliberately
 * broader than the supported subset (no disk-number, prefix-sign, method,
 * entry-count, tiling or local-header plausibility requirement).
 *
 * An EOCD yields a view for EACH place a known reader looks for the central
 * directory, whenever a central-directory signature is actually there:
 *   - 'relative': eocd - cdSize (Python zipfile, libarchive; Info-ZIP first);
 *   - 'absolute': cdOffset as an absolute file offset (Info-ZIP's
 *     "reported length of central directory is ... too long. Compensating..."
 *     fallback, R42-IV-F1), local headers then also absolute.
 * Requiring a real CD signature at the resolved position (two independent
 * signatures linked by the EOCD fields) keeps random signature bytes from
 * counting. An empty archive (cdSize 0, no entries) and ZIP64 markers also
 * count. Records are walked while signatures continue (bounded by
 * maxArchiveEntries + 1 per view and MAX_CD_RECORDS_PER_BUFFER across all
 * views of one buffer, beyond which the buffer fails closed); `tiled` says
 * whether they end exactly at the EOCD.
 */
function zipStructuralViews(buf, eocd, limits, budget = { left: MAX_CD_RECORDS_PER_BUFFER }) {
  if (eocd < 0 || eocd + 22 > buf.length || buf.readUInt32LE(eocd) !== ZIP_EOCD_SIG) return [];
  const eocdEnd = Math.min(buf.length, eocd + 22 + buf.readUInt16LE(eocd + 20));
  const nTotal = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
  if ((eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) || nTotal === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    return [{ eocd, eocdEnd, cdStart: eocd, spanStart: Math.max(0, eocd - 20), mode: 'zip64', zip64: true, entries: [] }];
  }
  const views = [];
  const relStart = eocd - cdSize;
  const walk = (cdStart, delta, mode) => {
    if (cdStart < 0 || cdStart > eocd) return;
    if (cdStart === eocd) { if (cdSize === 0 && nTotal === 0) views.push({ eocd, eocdEnd, cdStart, spanStart: cdStart, mode, tiled: true, entries: [] }); return; }
    if (cdStart + 46 > buf.length || buf.readUInt32LE(cdStart) !== ZIP_CD_SIG) return;
    const entries = [];
    let p = cdStart;
    while (p < eocd && p + 46 <= buf.length && buf.readUInt32LE(p) === ZIP_CD_SIG) {
      if (entries.length > limits.maxArchiveEntries) { views.push({ eocd, eocdEnd, cdStart, spanStart: cdStart, mode, tooMany: true, entries: [] }); return; }
      if (--budget.left < 0) throw new ArchiveError(`too many ZIP central-directory records to inspect safely (> ${MAX_CD_RECORDS_PER_BUFFER} per buffer)`);
      const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
      const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
      const lh = buf.readUInt32LE(p + 42) + delta;
      let dataStart = -1, dataEnd = -1;
      if (lh >= 0 && lh + 30 <= buf.length && buf.readUInt32LE(lh) === ZIP_LOCAL_SIG) {
        dataStart = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
        dataEnd = dataStart + csize;
      }
      entries.push({ method, start: lh, dataStart, dataEnd });
      p += 46 + nlen + elen + clen;
    }
    // R4.3: the span covers every CLAIMED local-header position (resolvable or
    // not), so a structure whose parts sit in different regions never looks contained.
    let spanStart = cdStart;
    for (const e of entries) if (e.start >= 0 && e.start < spanStart) spanStart = e.start;
    views.push({ eocd, eocdEnd, cdStart, spanStart, mode, tiled: p === eocd, entries });
  };
  walk(relStart, relStart - cdOffset, 'relative');
  if (cdOffset !== relStart) walk(cdOffset, 0, 'absolute');
  return views;
}

/** Every structural ZIP interpretation in `buf` (bounded by MAX_SIG_POSITIONS EOCD candidates). */
function zipInterpretations(buf, limits) {
  const out = [];
  const budget = { left: MAX_CD_RECORDS_PER_BUFFER };
  for (const e of allPositions(buf, ZIP_EOCD_BYTES)) out.push(...zipStructuralViews(buf, e, limits, budget));
  return out;
}

/**
 * True when `buf` contains a ZIP structure a standard tool could read:
 * R4.2/R4.3 -- any structural EOCD interpretation (relative OR absolute
 * central-directory location, see zipStructuralViews); R4.4 -- a streaming-
 * reader lead signature at offset 0 (hasZipLeadSignature, which includes a
 * local-file header there), or an extractable local-file header ANYWHERE
 * (extractableLocalHeader: structural, independent of version, name, CRC or
 * deflate validity). Every candidate is then parsed strictly and fails closed
 * unless it is a complete, supported archive.
 */
function hasZipStructure(buf, limits = INSPECTION_LIMITS) {
  if (hasZipLeadSignature(buf)) return true;
  if (zipInterpretations(buf, limits).length) return true;
  for (const l of allPositions(buf, ZIP_LOCAL_BYTES)) if (extractableLocalHeader(buf, l)) return true;
  return false;
}

/**
 * R4.2 (IV1-F1): every ZIP interpretation of a gzip or tar container's RAW
 * bytes must be wholly inside a region whose exact bytes are inspected as a
 * nested archive (tar entry data, gzip header fields), or appear byte-for-byte
 * in the decompressed output (`copy`, e.g. deflate stored blocks) where the
 * same rules inspect it. Anything else is a cross-format (polyglot)
 * interpretation that no inspected view contains: fail closed.
 */
function assertZipInterpretationsAccounted(buf, regions, copy, kind, limits) {
  for (const v of zipInterpretations(buf, limits)) {
    const start = v.spanStart, end = v.eocdEnd;
    // R4.3: an absolute-offset interpretation depends on where the bytes sit in
    // THIS file, so a nested view of a sub-region cannot reproduce it: fail closed.
    if (v.mode === 'absolute') throw new ArchiveError(`ambiguous archive: the raw bytes of this ${kind} container form a ZIP archive reachable only through an absolute central-directory offset (bytes ${start}-${end}; reader-fallback interpretation)`);
    if (regions.some((r) => start >= r.start && end <= r.end)) continue;
    if (copy && copy.indexOf(buf.subarray(start, end)) !== -1) continue;
    throw new ArchiveError(`ambiguous archive: the raw bytes of this ${kind} container also form a ZIP archive (bytes ${start}-${end}) that is not wholly inside any inspected region (cross-format/polyglot interpretation)`);
  }
}

function parseZipEntries(buf, limits) {
  // R4.1 (N2/N3) + R4.2: consider EVERY end-of-central-directory candidate,
  // wherever it is, by STRUCTURE (what any reader could use), not only those
  // the strict parser accepts.
  let interps = zipInterpretations(buf, limits);
  if (interps.length === 0) {
    // Report the most specific strict-parser reason (ZIP64, multi-disk, ...).
    let lastErr = null;
    for (const e of allPositions(buf, ZIP_EOCD_BYTES)) { try { parseZipCentralDirectory(buf, e, limits); } catch (err) { lastErr = err; } }
    throw (lastErr instanceof ArchiveError && !/end-of-central-directory record truncated/.test(lastErr.message) ? lastErr : new ArchiveError('malformed or truncated ZIP (no valid end-of-central-directory record)'));
  }
  // R4.3 (R42-IV-F1/F2): the interpretation a stock seekable reader uses is
  // the one at the LAST end-of-central-directory record. It must be reachable
  // through the relative location (the only one the strict parser accepts)
  // and strictly validate; a disagreeing or absolute-only location is a
  // reader-fallback interpretation: fail closed (never "no archive").
  const lastEocd = Math.max(...interps.map((v) => v.eocd));
  const top = interps.find((v) => v.eocd === lastEocd && v.mode !== 'absolute');
  if (!top) throw new ArchiveError('ambiguous ZIP: the central directory is reachable only through the absolute-offset fallback (inconsistent EOCD size/offset; Info-ZIP "compensating" interpretation)');
  const z = parseZipCentralDirectory(buf, lastEocd, limits); // strict: unsupported features fail closed here
  // R4.3 (R42-IV-F2): EVERY other interpretation is exempt as a nested archive
  // only when it lies wholly inside the data of a STRICTLY VALIDATED,
  // non-directory entry of that top-level archive (CD/local agreement, bounds
  // and tiling checked below; CRC and size on load). Boundaries claimed by
  // any other, unvalidated structure never grant an exemption. The nested
  // content is then inspected recursively (depth- and budget-limited).
  // The absolute-offset view of the top EOCD (when it differs from the
  // relative one) is treated like any other competing view.
  const nEocd = new Set(interps.map((x) => x.eocd)).size;
  for (const v of interps) {
    if (v === top) continue;
    if (z.entries.some((e) => !e.isDir && v.spanStart >= e.dataStart && v.eocdEnd <= e.dataEnd)) continue;
    if (nEocd === 1) throw new ArchiveError('ambiguous ZIP: the end-of-central-directory record resolves to two different central directories (relative and absolute offsets disagree)');
    throw new ArchiveError(`multiple ZIP central directories (${nEocd}): concatenated or embedded archives with competing interpretations (a central directory outside the validated entries of the top-level archive)`);
  }
  const entries = z.entries;
  // Every byte between the first local header and the central directory must
  // belong to an entry: local header, data and (R4.2) a VALIDATED data
  // descriptor when one is declared. No gaps, no overlaps.
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  let cursor = sorted.length ? sorted[0].start : z.cdStart;
  for (const e of sorted) {
    if (e.start < cursor) throw new ArchiveError('overlapping ZIP entries');
    if (e.start !== cursor) throw new ArchiveError('unreferenced bytes inside ZIP archive');
    cursor = e.end;
  }
  if (z.cdStart !== cursor) throw new ArchiveError('unreferenced bytes inside ZIP archive');
  // N3 + R4.2 (IV1-F2): ANY local-file-header signature that is not an entry
  // start and not inside an entry's data is a second (concatenated, embedded or
  // streaming-only) archive -- decided by position, not by whether its
  // author-controlled fields look "plausible".
  const starts = new Set(entries.map((e) => e.start));
  for (const pos of allPositions(buf, ZIP_LOCAL_BYTES)) {
    if (starts.has(pos)) continue;
    if (entries.some((e) => pos >= e.dataStart && pos < e.dataEnd)) continue;
    throw new ArchiveError('unreferenced ZIP local file header (concatenated, embedded or streaming-only archive)');
  }
  const prefixEnd = sorted.length ? sorted[0].start : z.cdStart;
  const regions = [];
  // R4.4: a lone 4-byte spanning marker (PK\7\8 or "PK00") before the first
  // entry belongs to the archive itself; any other prefix is inspected (and a
  // prefix that is itself a ZIP candidate fails closed).
  const spanMarker = prefixEnd === 4 && (buf.readUInt32LE(0) === ZIP_DESC_SIG || buf.readUInt32LE(0) === 0x30304b50);
  if (prefixEnd > 0 && !spanMarker) regions.push({ label: '<zip prefix>', data: buf.subarray(0, prefixEnd) });
  if (z.eocdEnd < buf.length) regions.push({ label: '<zip suffix>', data: buf.subarray(z.eocdEnd) });
  for (const m of z.meta) regions.push(m);
  return {
    regions,
    entries: entries.map((e) => ({
      name: e.name,
      isDir: e.isDir,
      load: (budget) => {
        // N6: a directory entry must carry no data at all.
        if (e.isDir && e.usize !== 0) throw new ArchiveError(`directory entry with data "${e.name}"`);
        budget.reserve(e.usize, e.name); // declared size must fit the limits before anything is decompressed
        if (e.usize >= 1024 * 1024 && e.usize / Math.max(1, e.csize) > limits.maxCompressionRatio) throw new ArchiveError(`compression-ratio limit (${limits.maxCompressionRatio}) exceeded for "${e.name}"`);
        const raw = buf.subarray(e.dataStart, e.dataEnd);
        let out;
        if (e.method === 0) {
          if (e.csize !== e.usize) throw new ArchiveError(`size mismatch in stored entry "${e.name}"`);
          out = raw;
        } else if (e.csize === 0 && e.usize === 0) {
          out = Buffer.alloc(0);
        } else {
          // N5: the declared size is a HARD cap on actual output (1 byte when 0 is declared).
          let r;
          try { r = inflateRawBounded(raw, e.usize, e.name); } catch (err) {
            if (/exceeds its limit/.test(err.message)) throw new ArchiveError(`decompression error or size above declared for "${e.name}" (actual output exceeds the declared ${e.usize} bytes)`);
            throw err;
          }
          if (r.consumed !== raw.length) throw new ArchiveError(`deflate stream does not span the entry data (hidden trailing bytes) in "${e.name}"`);
          out = r.out;
        }
        if (out.length !== e.usize) throw new ArchiveError(`decompressed size mismatch for "${e.name}"`);
        if (crc32(out) !== e.crc) throw new ArchiveError(`CRC mismatch (corrupt entry) for "${e.name}"`);
        if (e.isDir && out.length !== 0) throw new ArchiveError(`directory entry with data "${e.name}"`);
        return out;
      },
    })),
  };
}

function parseOctal(field, what) {
  if (field[0] & 0x80) throw new ArchiveError(`unsupported tar base-256 ${what}`);
  const s = field.toString('latin1').replace(/\0.*$/s, '').trim();
  if (s === '') return 0;
  if (!/^[0-7]+$/.test(s)) throw new ArchiveError(`malformed tar ${what}`);
  return parseInt(s, 8);
}

/** R4.1 (N4): a tar header is recognised by its checksum and numeric fields (v7, ustar, GNU, pax), not by magic. */
function isTarHeader(buf, off = 0) {
  if (off + 512 > buf.length) return false;
  const h = buf.subarray(off, off + 512);
  if (h[0] === 0) return false;
  try {
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (parseOctal(h.subarray(148, 156), 'checksum') !== sum) return false;
    parseOctal(h.subarray(124, 136), 'size');
    parseOctal(h.subarray(100, 108), 'mode');
  } catch { return false; }
  return true;
}

/**
 * Treat as tar when the header validates (any format, incl. v7) OR when it
 * carries the ustar magic -- in the latter case it is then parsed strictly,
 * so a ustar/GNU archive with a corrupt header fails closed (R4 behaviour).
 */
function isTarCandidate(buf, off = 0) {
  return isTarHeader(buf, off) || (off + 512 <= buf.length && buf.toString('latin1', off + 257, off + 262) === 'ustar');
}

/** Strict pax record parsing: "<len> <key>=<value>\n" records must tile the data exactly. */
function parsePaxRecords(data) {
  const rec = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp === -1 || sp - i > 20) throw new ArchiveError('malformed pax record');
    const lenStr = data.toString('latin1', i, sp);
    if (!/^[1-9][0-9]*$/.test(lenStr)) throw new ArchiveError('malformed pax record length');
    const len = parseInt(lenStr, 10);
    if (i + len > data.length || data[i + len - 1] !== 0x0a) throw new ArchiveError('malformed pax record (length mismatch)');
    const kv = data.toString('utf8', sp + 1, i + len - 1);
    const eq = kv.indexOf('=');
    if (eq <= 0) throw new ArchiveError('malformed pax record (no key)');
    rec[kv.slice(0, eq)] = kv.slice(eq + 1);
    i += len;
  }
  return rec;
}

function parseTarEntries(buf, limits) {
  const entries = [];
  const names = new Set();
  let off = 0;
  let longName = null;
  let paxPath = null;
  let ended = false;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) {
      if (!buf.subarray(off).every((b) => b === 0)) throw new ArchiveError('unexpected data after tar end-of-archive marker');
      ended = true;
      break;
    }
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    if (parseOctal(h.subarray(148, 156), 'checksum') !== sum) throw new ArchiveError('tar header checksum mismatch (corrupt archive)');
    const ustar = h.toString('latin1', 257, 262) === 'ustar';
    // N7: header bytes no format defines must be zero (v7: 257-511; ustar/GNU: 500-511).
    if (!h.subarray(ustar ? 500 : 257, 512).every((b) => b === 0)) throw new ArchiveError('nonzero bytes in unused tar header fields');
    const size = parseOctal(h.subarray(124, 136), 'size');
    const type = String.fromCharCode(h[156] || 0x30);
    const dataStart = off + 512;
    const dataEnd = dataStart + size;
    const next = dataStart + Math.ceil(size / 512) * 512;
    if (next > buf.length) throw new ArchiveError('truncated tar entry');
    const data = buf.subarray(dataStart, dataEnd);
    // N7: padding after the data must be zero.
    if (!buf.subarray(dataEnd, next).every((b) => b === 0)) throw new ArchiveError('nonzero tar padding');
    off = next;
    if (entries.length + 1 > limits.maxArchiveEntries) throw new ArchiveError(`archive entry-count limit (${limits.maxArchiveEntries}) exceeded`);
    if (type === 'L' || type === 'K') {
      // GNU long name / long link: the payload is inspected like any entry data.
      entries.push({ name: `<GNU long ${type === 'L' ? 'name' : 'link'} record>`, meta: true, range: { start: dataStart, end: dataEnd }, load: () => data });
      if (type === 'L') longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'x') {
      const rec = parsePaxRecords(data);
      if (Object.keys(rec).some((k) => k === 'size' || k === 'linkpath' || k.startsWith('GNU.sparse.'))) throw new ArchiveError('unsupported pax header (size/link/sparse override)');
      entries.push({ name: '<pax extended header>', meta: true, range: { start: dataStart, end: dataEnd }, load: () => data });
      paxPath = Object.prototype.hasOwnProperty.call(rec, 'path') ? rec.path : null;
      continue;
    }
    if (type === 'g') throw new ArchiveError('unsupported global pax header');
    let name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    if (ustar) {
      const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/s, '');
      if (prefix) name = `${prefix}/${name}`;
    }
    if (paxPath !== null) name = paxPath;
    if (longName !== null) name = longName;
    longName = null;
    paxPath = null;
    if (type === '1' || type === '2') throw new ArchiveError(`link entry "${name}" is not supported`);
    if (type !== '0' && type !== '7' && type !== '5') throw new ArchiveError(`unsupported tar entry type "${type}" for "${name}"`);
    const isDir = type === '5';
    if (isDir && size !== 0) throw new ArchiveError(`directory entry with data "${name}"`);
    // `tar -C dir .` writes a "./" root entry: an empty path after normalisation is only allowed for that directory.
    const norm = name.replace(/^(\.\/)+/, '').replace(/^\.$/, '');
    if (norm === '' || norm === '/') { if (!isDir) throw new ArchiveError('empty entry path'); continue; }
    checkEntryPath(norm);
    const key = norm.replace(/\/$/, '');
    if (names.has(key)) throw new ArchiveError(`duplicate entry path "${name}"`);
    names.add(key);
    entries.push({ name, isDir, range: { start: dataStart, end: dataEnd }, load: () => data });
  }
  if (!ended) throw new ArchiveError('truncated tar (no end-of-archive marker)');
  return entries;
}

/**
 * R4.1 (N1): gzip parsed member by member (RFC 1952). Every input byte must
 * belong to a member: header, deflate stream (exact length from zlib), CRC32
 * and ISIZE trailer. Multi-member gzip is decompressed in full (as gunzip
 * does); ANY other trailing bytes fail closed. Output is hard-capped.
 * G5-C11 (C10-F4): at most limits.maxGzipMembers members, and the scan's
 * work-time budget (`overTime`, when given) is checked before every member;
 * either limit fails closed as an ArchiveError.
 */
function gunzipBounded(buf, limits, budget, label, overTime = () => false) {
  const cap = Math.min(limits.maxArchiveEntryBytes, budget.remaining());
  const maxMembers = limits.maxGzipMembers ?? INSPECTION_LIMITS.maxGzipMembers;
  const outs = [];
  const headers = [];
  const fields = []; // R4.2 (IV1-F1): FEXTRA / FNAME / FCOMMENT contents, as absolute ranges of `buf`
  let total = 0;
  let pos = 0;
  while (pos < buf.length) {
    if (headers.length >= maxMembers) throw new ArchiveError(`gzip member-count limit (${maxMembers}) exceeded for "${label}"`);
    if (overTime()) throw new ArchiveError(`work-time budget (${limits.maxScanMs} ms) exceeded while decompressing gzip stream "${label}"`);
    if (pos + 18 > buf.length || buf[pos] !== 0x1f || buf[pos + 1] !== 0x8b) throw new ArchiveError(pos === 0 ? `corrupt or truncated gzip stream "${label}" (bad header)` : `unexpected data after gzip member in "${label}" (trailing bytes are not inspected by gunzip; failing closed)`);
    if (buf[pos + 2] !== 8) throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (unsupported method)`);
    const flg = buf[pos + 3];
    if (flg & 0xe0) throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (reserved flags)`);
    let p = pos + 10;
    if (flg & 0x04) {
      if (p + 2 > buf.length) throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (FEXTRA length)`);
      const xlen = buf.readUInt16LE(p);
      if (p + 2 + xlen > buf.length) throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (FEXTRA overruns the stream)`);
      fields.push({ label: 'FEXTRA', start: p + 2, end: p + 2 + xlen });
      p += 2 + xlen;
    }
    for (const [bit, name] of [[0x08, 'FNAME'], [0x10, 'FCOMMENT']]) if (flg & bit) {
      const z0 = buf.indexOf(0, p);
      if (z0 === -1) throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (${name} not terminated)`);
      fields.push({ label: name, start: p, end: z0 });
      p = z0 + 1;
    }
    if (flg & 0x02) {
      // R4.2: FHCRC is verified (as Python's gzip module does), not skipped.
      if (p + 2 > buf.length) throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (FHCRC)`);
      if ((crc32(buf.subarray(pos, p)) & 0xffff) !== buf.readUInt16LE(p)) throw new ArchiveError(`corrupt gzip stream "${label}" (header CRC mismatch)`);
      p += 2;
    }
    if (p >= buf.length) throw new ArchiveError(`corrupt or truncated gzip stream "${label}"`);
    headers.push(buf.subarray(pos, p));
    const remainingCap = cap - total;
    if (remainingCap < 1) throw new ArchiveError(`decompressed-size limit exceeded for gzip stream "${label}"`);
    let r;
    try { r = inflateRawBounded(buf.subarray(p), remainingCap, label); } catch (err) {
      if (/exceeds its limit/.test(err.message)) throw new ArchiveError(`decompressed-size limit exceeded for gzip stream "${label}"`);
      throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (${err.message})`);
    }
    const t = p + r.consumed;
    if (t + 8 > buf.length) throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (missing trailer)`);
    if (buf.readUInt32LE(t) !== crc32(r.out) || buf.readUInt32LE(t + 4) !== (r.out.length >>> 0)) throw new ArchiveError(`corrupt or truncated gzip stream "${label}" (CRC/size trailer mismatch)`);
    outs.push(r.out);
    total += r.out.length;
    pos = t + 8;
  }
  // G5-C13 (C12-F7): the budget is checked once more after the last member, before the members are joined.
  if (overTime()) throw new ArchiveError(`work-time budget (${limits.maxScanMs} ms) exceeded after decompressing gzip stream "${label}"`);
  const out = outs.length === 1 ? outs[0] : Buffer.concat(outs);
  if (out.length >= 1024 * 1024 && out.length / Math.max(1, buf.length) > limits.maxCompressionRatio) throw new ArchiveError(`compression-ratio limit (${limits.maxCompressionRatio}) exceeded for gzip stream "${label}"`);
  budget.reserve(out.length, label);
  return { out, headers, fields };
}

/**
 * R4.2 (IV1-F1): a tar container's raw bytes outside entry data are tar
 * structure only (headers, zero padding, zero end marker). Any ZIP signature
 * there, or any ZIP interpretation not wholly inside one entry's data, is a
 * cross-format interpretation: fail closed.
 */
function assertTarHasNoForeignZip(buf, entries, limits) {
  const regions = entries.filter((e) => e.range).map((e) => e.range);
  for (const sig of [ZIP_LOCAL_BYTES, ZIP_EOCD_BYTES]) {
    for (const pos of allPositions(buf, sig)) {
      if (!regions.some((r) => pos >= r.start && pos + 4 <= r.end)) throw new ArchiveError(`ambiguous archive: ZIP signature in tar header/padding bytes at ${pos} (cross-format/polyglot interpretation)`);
    }
  }
  assertZipInterpretationsAccounted(buf, regions, null, 'tar', limits);
}

/**
 * 'zip' | 'gzip' | 'tar' | null, from content only (R4.1: tar by checksum; ZIP
 * by structure anywhere). R4.2: the first match only picks the PARSER; the
 * parser then accounts for every other supported interpretation of the same
 * bytes (gzip+tar polyglots fail closed; raw ZIP structures inside gzip/tar
 * must lie inside an inspected region), so precedence can no longer hide one.
 */
function detectArchiveInBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  if (isTarCandidate(buf, 0)) return 'tar';
  if (hasZipLeadSignature(buf) || buf.indexOf(ZIP_EOCD_BYTES) !== -1 || buf.indexOf(ZIP_LOCAL_BYTES) !== -1) {
    try { if (hasZipStructure(buf)) return 'zip'; } catch { return 'zip'; } // too many candidates: inspect (and fail closed)
  }
  return null;
}

/**
 * AURA-PALM-G5-I1-R3/R4 -- inspect every regular file reachable under the
 * configured scan roots, and every entry of every supported archive among
 * them. Symlinks are resolved: targets inside an approved root are inspected
 * (each real file once, however many links point to it); targets outside
 * every root, broken links, loops and directory cycles are blocking errors.
 * FIFOs, sockets, device nodes and any other non-regular, non-directory
 * object are blocking errors (never opened). Returns { hits, errors, stats }.
 */
function inspectArtifacts(root, limits = INSPECTION_LIMITS) {
  const hits = [];
  const errors = [];
  const stats = { roots: [], absentOptionalRoots: [], files: 0, bytes: 0, symlinksFollowed: 0, duplicateReferences: 0, archives: 0, archiveEntries: 0, archiveCompressedBytes: 0, decompressedBytes: 0, ms: 0 };
  const t0 = Date.now();
  const sigs = signatureSet();
  const relOf = (p) => path.relative(root, p).split(path.sep).join('/');
  const typeOf = (st) => (st.isFIFO() ? 'FIFO (named pipe)' : st.isSocket() ? 'Unix-domain socket' : st.isBlockDevice() ? 'block device' : st.isCharacterDevice() ? 'character device' : 'unsupported filesystem object');
  let stopped = false;
  const overTime = () => {
    if (!stopped && Date.now() - t0 > limits.maxScanMs) { errors.push({ file: '(scan)', error: `work-time budget (${limits.maxScanMs} ms) exceeded` }); stopped = true; }
    return stopped;
  };

  // ---- R3-N3: resolve configured roots under the build-mode contract.
  let appReal;
  try { appReal = fs.realpathSync(root); } catch (e) { errors.push({ file: '.', error: `cannot resolve the app root (${e.code || e.message})` }); return { hits, errors, stats }; }
  const rootReal = [];
  for (const cfg of SCAN_ROOTS) {
    const abs = path.join(root, cfg.rel);
    let lst;
    try { lst = fs.lstatSync(abs); } catch (e) {
      if (e.code === 'ENOENT') {
        // Only a genuinely absent path; a dangling parent symlink also lands here,
        // so check every existing ancestor for a broken link.
        let p = path.dirname(abs), brokenAncestor = null;
        while (p.startsWith(root) && p !== root) { try { const a = fs.lstatSync(p); if (a.isSymbolicLink()) { try { fs.realpathSync(p); } catch { brokenAncestor = p; } } } catch { /* absent ancestor */ } p = path.dirname(p); }
        if (brokenAncestor) errors.push({ file: cfg.rel, error: `scan root unreachable: broken symlink at ${relOf(brokenAncestor)}` });
        else if (cfg.required) errors.push({ file: cfg.rel, error: `required scan root missing: no ${cfg.rel} found -- run \`next build\` first` });
        else stats.absentOptionalRoots.push(cfg.rel);
      } else errors.push({ file: cfg.rel, error: `scan root inaccessible (${e.code || e.message})` });
      continue;
    }
    let real;
    if (lst.isSymbolicLink()) {
      try { real = fs.realpathSync(abs); } catch (e) { errors.push({ file: cfg.rel, error: e.code === 'ELOOP' ? 'scan root is a symlink loop' : `scan root is a broken symlink (${e.code || e.message})` }); continue; }
      if (!real.startsWith(appReal + path.sep)) { errors.push({ file: cfg.rel, error: 'scan root symlink points outside the app directory (not traversed)' }); continue; }
    } else real = fs.realpathSync(abs);
    let st;
    try { st = fs.statSync(real); } catch (e) { errors.push({ file: cfg.rel, error: `scan root inaccessible (${e.code || e.message})` }); continue; }
    if (!st.isDirectory()) { errors.push({ file: cfg.rel, error: 'scan root is not a directory' }); continue; }
    try { fs.accessSync(real, fs.constants.R_OK | fs.constants.X_OK); fs.readdirSync(real); } catch (e) { errors.push({ file: cfg.rel, error: `scan root inaccessible (${e.code || e.message})` }); continue; }
    rootReal.push({ rel: cfg.rel, real });
  }
  const within = (real) => rootReal.some((r) => real === r.real || real.startsWith(r.real + path.sep));
  const seenFiles = new Set();
  const seenDirs = new Set();
  let totalDecompressed = 0;

  // ---- archives
  const inspectArchive = (buf, kind, shown, depth, budget) => {
    if (overTime()) return;
    stats.archives++;
    let entries;
    let regions = [];
    const rawHits = (data, label) => { for (const s of inspectBufferBytes(data, sigs)) hits.push({ file: label, sentinel: `${s} (archive entry)` }); };
    if (kind === 'gzip') {
      // R4.2 (IV1-F1): the same bytes may not also be a tar archive (a raw-mode
      // tar reader would see different content than gunzip).
      if (isTarCandidate(buf, 0)) throw new ArchiveError('ambiguous archive: the input is both a gzip stream and a tar archive (polyglot)');
      const { out, headers, fields } = gunzipBounded(buf, limits, budget, shown, overTime);
      for (const hb of headers) rawHits(hb, `${shown}!<gzip header>`);
      // R4.2 (IV1-F1): header fields get the same nested inspection as ZIP
      // comments/extra fields and tar metadata, and no raw ZIP may sit outside them.
      assertZipInterpretationsAccounted(buf, fields, out, 'gzip', limits);
      for (const f of fields) regions.push({ label: `<gzip ${f.label}>`, data: buf.subarray(f.start, f.end) });
      if (isTarCandidate(out, 0)) {
        // N7: the whole decompressed tar stream (headers, metadata, padding) is byte-scanned too.
        rawHits(out, `${shown}!<tar stream>`);
        entries = parseTarEntries(out, limits);
        assertTarHasNoForeignZip(out, entries, limits);
      } else {
        for (const r of regions) {
          if (overTime()) return; // G5-C11 (C10-F4): budget checked per header field, not only per archive
          inspectEntryData(r.data, `${shown}!${r.label}`, `${shown}!${r.label}`, depth, budget);
        }
        if (overTime()) return; // G5-C13 (C12-F7): and before the decompressed stream is scanned
        inspectEntryData(out, `${shown}!<gzip stream>`, `${shown}`, depth, budget);
        return;
      }
    } else if (kind === 'tar') { entries = parseTarEntries(buf, limits); assertTarHasNoForeignZip(buf, entries, limits); }
    else { const z = parseZipEntries(buf, limits); entries = z.entries; regions = z.regions; }
    // N2/N3/N7: bytes outside entries (prefix, suffix, comments, extra fields) are inspected as well.
    for (const r of regions) inspectEntryData(r.data, `${shown}!${r.label}`, `${shown}!${r.label}`, depth, budget);
    for (const e of entries) {
      if (overTime()) return;
      const label = `${shown}!${e.name}`;
      if (!e.meta) {
        const byName = nameRule(e.name, path.posix.basename(e.name.replace(/\/$/, '')));
        if (byName) hits.push({ file: label, sentinel: `${byName} (archive entry)` });
      }
      if (stats.files + stats.archiveEntries + 1 > limits.maxFiles) throw new ArchiveError(`file-count limit (${limits.maxFiles}) exceeded`);
      const data = e.load(budget); // N6: directory entries are loaded and must be empty
      stats.archiveEntries++;
      inspectEntryData(data, label, label, depth, budget);
    }
    overTime(); // G5-C15 (C14-P3-2): also checked after the last tar / ZIP entry
  };
  const inspectEntryData = (data, label, shownForNested, depth, budget) => {
    for (const s of inspectBufferBytes(data, sigs)) hits.push({ file: label, sentinel: `${s} (archive entry)` });
    const nested = detectArchiveInBuffer(data);
    if (nested) {
      if (depth + 1 > limits.maxNestedArchiveDepth) throw new ArchiveError(`nested archive beyond the depth limit (${limits.maxNestedArchiveDepth}) at "${label}"`);
      inspectArchive(data, nested, shownForNested, depth + 1, budget);
    } else assertNoForeignStream(data, label); // G5-D7-A: archive members and container regions
  };
  const makeBudget = () => {
    let used = 0;
    return {
      remaining: () => Math.min(limits.maxArchiveDecompressedBytes - used, limits.maxTotalDecompressedBytes - totalDecompressed),
      reserve(n, label) {
        if (n > limits.maxArchiveEntryBytes) throw new ArchiveError(`decompressed entry-size limit (${limits.maxArchiveEntryBytes}) exceeded for "${label}"`);
        if (used + n > limits.maxArchiveDecompressedBytes) throw new ArchiveError(`per-archive decompressed-bytes limit (${limits.maxArchiveDecompressedBytes}) exceeded`);
        if (totalDecompressed + n > limits.maxTotalDecompressedBytes) throw new ArchiveError(`total decompressed-bytes limit (${limits.maxTotalDecompressedBytes}) exceeded`);
        used += n;
        totalDecompressed += n;
        stats.decompressedBytes += n;
      },
    };
  };

  const visitFile = (shownPath, realPath, size) => {
    if (seenFiles.has(realPath)) { stats.duplicateReferences++; return; }
    seenFiles.add(realPath);
    if (overTime()) return;
    if (stats.files + stats.archiveEntries + 1 > limits.maxFiles) { errors.push({ file: relOf(shownPath), error: `file-count limit (${limits.maxFiles}) exceeded` }); stopped = true; return; }
    if (size > limits.maxFileBytes) { errors.push({ file: relOf(shownPath), error: `file too large to inspect (${size} bytes > ${limits.maxFileBytes})` }); return; }
    if (stats.bytes + size > limits.maxTotalBytes) { errors.push({ file: relOf(shownPath), error: `total-bytes limit (${limits.maxTotalBytes}) exceeded` }); stopped = true; return; }
    stats.files++;
    stats.bytes += size;
    const shown = relOf(shownPath);
    const byName = nameRule(shown, path.basename(shownPath)) || nameRule(relOf(realPath), path.basename(realPath));
    if (byName) hits.push({ file: shown, sentinel: byName });
    let scanRes;
    try {
      scanRes = inspectFileBytes(realPath, size, sigs, limits);
      for (const label of scanRes.labels) hits.push({ file: shown, sentinel: label });
    } catch (e) {
      errors.push({ file: shown, error: `unreadable (${e.code || e.message})` });
      return;
    }
    // R3-N1 / R4.1: supported archives are inspected entry by entry.
    let head;
    try {
      const fd = fs.openSync(realPath, 'r');
      try { head = Buffer.alloc(Math.min(512, size)); fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
    } catch (e) { errors.push({ file: shown, error: `unreadable (${e.code || e.message})` }); return; }
    const gzHead = head.length >= 3 && head[0] === 0x1f && head[1] === 0x8b;
    const tarHead = isTarCandidate(head, 0);
    const zipSigs = scanRes.zipPositions.length > 0 || scanRes.zipOverflow || hasZipLeadSignature(head); // R4.4: streaming lead
    const headForeign = headForeignFormat(head); // G5-C15 / G5-C17: offset-0-only formats (.Z, pack, LZH, old gzip magic)
    const foreignSigs = scanRes.foreignPositions.length > 0 || scanRes.foreignOverflow || !!headForeign; // G5-D7-A
    if (!gzHead && !tarHead && !zipSigs && !foreignSigs) return;
    if (size > limits.maxArchiveBytes) {
      let tooLarge = gzHead || tarHead;
      if (!tooLarge && zipSigs) { try { tooLarge = largeFileHasPlausibleZip(realPath, size, scanRes.zipPositions, scanRes.zipOverflow); } catch (e) { errors.push({ file: shown, error: `unreadable (${e.code || e.message})` }); return; } }
      if (tooLarge) { errors.push({ file: shown, error: `archive too large to inspect (${size} bytes > ${limits.maxArchiveBytes})` }); return; }
      if (foreignSigs) {
        let f = null;
        if (scanRes.foreignOverflow) f = { format: 'too many archive/compressed-stream signatures', pos: 0 };
        else if (headForeign) f = { format: headForeign, pos: 0 };
        else { try { f = largeFileForeignStream(realPath, size, scanRes.foreignPositions); } catch (e) { errors.push({ file: shown, error: `unreadable (${e.code || e.message})` }); return; } }
        if (f) errors.push({ file: shown, error: `archive not fully inspectable: unsupported archive or compressed stream (${f.format}) at offset ${f.pos} of "${shown}" cannot be inspected (identifiable formats fail closed)` });
      }
      return;
    }
    let kind = null;
    let archiveBuf;
    try { archiveBuf = fs.readFileSync(realPath); kind = detectArchiveInBuffer(archiveBuf); } catch (e) { errors.push({ file: shown, error: `unreadable (${e.code || e.message})` }); return; }
    if (!kind) {
      // G5-D7-A: not a supported archive -- an identifiable uninspectable stream anywhere fails closed.
      if (foreignSigs) {
        try { assertNoForeignStream(archiveBuf, shown); } catch (e) {
          if (e instanceof ArchiveError) errors.push({ file: shown, error: `archive not fully inspectable: ${e.message}` });
          else errors.push({ file: shown, error: `archive inspection failed (${e.code || e.message})` });
        }
      }
      return;
    }
    try {
      const buf = archiveBuf;
      stats.archiveCompressedBytes += buf.length;
      inspectArchive(buf, kind, shown, 1, makeBudget());
    } catch (e) {
      if (e instanceof ArchiveError) errors.push({ file: shown, error: `archive not fully inspectable: ${e.message}` });
      else errors.push({ file: shown, error: `archive inspection failed (${e.code || e.message})` });
    }
  };

  const visitDir = (shownDir, realDir, depth, ancestors) => {
    if (stopped || overTime()) return;
    if (depth > limits.maxDepth) { errors.push({ file: relOf(shownDir), error: `depth limit (${limits.maxDepth}) exceeded` }); return; }
    if (seenDirs.has(realDir)) { stats.duplicateReferences++; return; }
    seenDirs.add(realDir);
    let names;
    try { names = fs.readdirSync(realDir).sort(); } catch (e) { errors.push({ file: relOf(shownDir), error: `unreadable directory (${e.code || e.message})` }); return; }
    for (const name of names) {
      if (stopped) return;
      const shown = path.join(shownDir, name);
      const actual = path.join(realDir, name);
      let st;
      try { st = fs.lstatSync(actual); } catch (e) { errors.push({ file: relOf(shown), error: `cannot stat (${e.code || e.message})` }); continue; }
      if (st.isSymbolicLink()) {
        let target;
        try { target = fs.realpathSync(actual); } catch (e) {
          errors.push({ file: relOf(shown), error: e.code === 'ELOOP' ? 'symlink loop' : `broken symlink (${e.code || e.message})` });
          continue;
        }
        if (!within(target)) { errors.push({ file: relOf(shown), error: 'symlink target outside the approved scan roots (not traversed)' }); continue; }
        let tst;
        try { tst = fs.statSync(target); } catch (e) { errors.push({ file: relOf(shown), error: `broken symlink (${e.code || e.message})` }); continue; }
        stats.symlinksFollowed++;
        if (tst.isDirectory()) {
          if (ancestors.has(target)) { errors.push({ file: relOf(shown), error: 'symlink cycle (points to an ancestor directory)' }); continue; }
          visitDir(shown, target, depth + 1, new Set([...ancestors, target]));
        } else if (tst.isFile()) visitFile(shown, target, tst.size);
        else errors.push({ file: relOf(shown), error: `symlink to an unsupported filesystem object: ${typeOf(tst)} (not opened)` });
        continue;
      }
      if (st.isDirectory()) visitDir(shown, actual, depth + 1, new Set([...ancestors, actual]));
      else if (st.isFile()) visitFile(shown, actual, st.size);
      else errors.push({ file: relOf(shown), error: `unsupported filesystem object: ${typeOf(st)} (not opened)` }); // R3-N4
    }
  };

  for (const r of rootReal) {
    const shown = path.join(root, r.rel);
    stats.roots.push(r.rel);
    visitDir(shown, r.real, 0, new Set([r.real]));
  }
  overTime(); // G5-C15 (C14-P3-2): and once more at the end of the scan
  stats.ms = Date.now() - t0;
  return { hits, errors, stats };
}

/** Back-compatible: every hit and every blocking scan error as a hit list. */
function scanImageInput(root) {
  const { hits, errors } = inspectArtifacts(root);
  return [...hits, ...errors.map((e) => ({ file: e.file, sentinel: `SCAN ERROR: ${e.error}` }))];
}

/** Human-readable statement of exactly what was inspected (used in OK lines). */
function describeInspection(st) {
  const mib = (n) => (n / 1048576).toFixed(1);
  const absent = st.absentOptionalRoots.length ? `; absent optional roots: ${st.absentOptionalRoots.join(', ')}` : '';
  return `inspected ${st.files} file(s), ${mib(st.bytes)} MiB, in ${st.roots.join(', ') || '(no roots)'}${absent}; ${st.archives} archive(s) with ${st.archiveEntries} entr(ies), ${mib(st.decompressedBytes)} MiB decompressed; ${st.symlinksFollowed} symlink(s) followed, ${st.duplicateReferences} repeated reference(s); signature-based (encoded/transformed payloads are not detected)`;
}

function scan(root) {
  const hits = [];
  for (const rel of SCAN_DIRS) {
    for (const file of walk(path.join(root, rel))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const s of [...SENTINELS, ...IMAGE_INPUT_SENTINELS]) if (text.includes(s)) hits.push({ file: path.relative(root, file), sentinel: s });
    }
  }
  return hits;
}

function devAssetsPresent(root) {
  const dir = path.join(root, DEV_ASSET_DIR);
  if (fs.existsSync(dir)) return true;
  // Also catch a copy that reached the standalone output.
  for (const file of walkAll(path.join(root, '.next/standalone'))) if (file.includes('palm-dev-assets')) return true;
  return false;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  // Unconditional (independent of content approval): dev assets never ship.
  if (devAssetsPresent(root)) {
    console.error(`[palmistry-bundle] FAIL: ${DEV_ASSET_DIR} (development-only MediaPipe assets) is present in this build tree. Run \`node scripts/palm-dev-assets.js --remove\` and rebuild.`);
    process.exit(1);
  }
  // AURA-PALM-G5-I1-R2 (R1-F3): unconditional -- content approval never
  // authorises image input, the MediaPipe runtime or model assets.
  const inspection = inspectArtifacts(root);
  if (inspection.errors.length) {
    console.error(`[palmistry-bundle] FAIL: SCAN ERROR -- the production artifact could not be fully inspected (${inspection.errors.length} blocking error(s)); failing closed:`);
    for (const e of inspection.errors.slice(0, 20)) console.error(`  ${e.error}  ->  ${e.file}`);
  }
  if (inspection.hits.length) {
    console.error(`[palmistry-bundle] FAIL: palm image-input code or MediaPipe artifacts are in this build (${inspection.hits.length} hit(s)). Production release of image input is not authorised, whatever the content-approval state:`);
    for (const h of inspection.hits.slice(0, 20)) console.error(`  ${h.sentinel}  ->  ${h.file}`);
  }
  if (inspection.errors.length || inspection.hits.length) process.exit(1);
  const inspected = describeInspection(inspection.stats);
  if (isPalmistryApproved()) {
    console.log(`[palmistry-bundle] content APPROVED -- inclusion allowed, nothing to check. (Image-input exclusion checked independently: OK; ${inspected}.)`);
    process.exit(0);
  }
  if (!fs.existsSync(path.join(root, '.next/static'))) {
    console.error('[palmistry-bundle] no .next/static found -- run `next build` first.');
    process.exit(1);
  }
  const hits = scan(root);
  if (hits.length > 0) {
    console.error('[palmistry-bundle] FAIL: unapproved Palmistry content found in the production build:');
    for (const h of hits.slice(0, 20)) console.error(`  ${h.sentinel}  ->  ${h.file}`);
    process.exit(1);
  }
  console.log(`[palmistry-bundle] OK: none of ${SENTINELS.length} Palmistry sentinels present in ${SCAN_DIRS.join(', ')} (nor any of ${IMAGE_INPUT_SENTINELS.length} image-input sentinels, ${MEDIAPIPE_SENTINELS.length} MediaPipe sentinels or MediaPipe artifacts; image-input check ${inspected}).`);
}

module.exports = { SENTINELS, IMAGE_INPUT_SENTINELS, MEDIAPIPE_SENTINELS, MEDIAPIPE_ARTIFACT_SIGNATURES, WASM_MEDIAPIPE_MARKERS, INSPECTION_LIMITS, SCAN_ROOTS, DEV_ASSET_DIR, SCAN_DIRS, ARTIFACT_DIRS, scan, scanImageInput, inspectArtifacts, describeInspection, detectArchiveInBuffer, findForeignStream, inflateRecover, devAssetsPresent };
