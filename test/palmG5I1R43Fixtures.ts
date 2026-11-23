/**
 * AURA-PALM-G5-I1-R4.3 -- deterministic synthetic fixture builders for the
 * ZIP-recognition (R42-IV-F1) and nested-entry-trust (R42-IV-F2) tests and
 * the stock-reader differential. Benign content only: the "payload" is plain
 * text; the scanner's MediaPipe signatures are added by the test where a
 * detection is needed. No real images, nothing extracted, no network.
 */
import * as zlib from 'zlib';

const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export const HELLO = Buffer.from('hello benign text\n'.repeat(10));

export interface Ent { name: string; data: Buffer; method?: number; attr?: number; lver?: number; time?: number; date?: number; lcsize?: number; csizeOverride?: number; flags?: number; descriptor?: Buffer }
export interface Layout {
  prefix?: Buffer;          // bytes before the first local header
  absolute?: boolean;       // local-header offsets and cdOffset are absolute file offsets (else relative to the first local header)
  cdSizeDelta?: number;     // added to the true central-directory size in the EOCD
  cdOffsetOverride?: number;
  trailer?: Buffer;         // bytes after the EOCD
  between?: Buffer;         // bytes between the last entry and the central directory
  base?: number;            // file offset at which this ZIP will finally sit (for container-absolute layouts)
}

/** Build a ZIP with full control of offsets (reviewer R42-IV-F1 layouts). Returns the bytes plus the layout facts. */
export function buildZip(entries: Ent[], L: Layout = {}) {
  const prefix = L.prefix ?? Buffer.alloc(0);
  const base = L.base ?? 0;
  const locals: Buffer[] = [];
  const cds: Buffer[] = [];
  const localAt: number[] = [];
  let off = prefix.length;
  for (const e of entries) {
    const method = e.method ?? 8;
    const comp = method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const crc = crc32(e.data);
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(e.lver ?? 20, 4); lh.writeUInt16LE(e.flags ?? 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(e.time ?? 0, 10); lh.writeUInt16LE(e.date ?? 0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(e.lcsize ?? comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const relLho = L.absolute ? base + off : off - prefix.length;
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x0314, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(e.flags ?? 0, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(e.time ?? 0, 12); cd.writeUInt16LE(e.date ?? 0, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(e.csizeOverride ?? comp.length, 20); cd.writeUInt32LE(e.data.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(((e.attr ?? 0o100644) << 16) >>> 0, 38); cd.writeUInt32LE(relLho, 42);
    const local = Buffer.concat([lh, name, comp, e.descriptor ?? Buffer.alloc(0)]);
    localAt.push(off);
    locals.push(local);
    cds.push(Buffer.concat([cd, name]));
    off += local.length;
  }
  const between = L.between ?? Buffer.alloc(0);
  const cdAt = off + between.length;
  const cdb = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  const cdOffset = L.cdOffsetOverride ?? (L.absolute ? base + cdAt : cdAt - prefix.length);
  const cdSize = cdb.length + (L.cdSizeDelta ?? 0);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdOffset, 16);
  const buf = Buffer.concat([prefix, ...locals, between, cdb, eocd, L.trailer ?? Buffer.alloc(0)]);
  return { buf, facts: { prefixLen: prefix.length, localAt, cdAt, cdTrueSize: cdb.length, eocdAt: cdAt + cdb.length, eocdCdSize: cdSize, eocdCdOffset: cdOffset, relativeCdStart: cdAt + cdb.length - cdSize } };
}

/** Exact reconstruction of the R4.2 reviewer's fixture C (expected sha256 cad8cc80...). */
export const reviewerC = () => buildZip([{ name: 'hello.txt', data: HELLO, lver: 0xff, time: 0xb5fa, date: 0x5d72, attr: 0o600 }], { prefix: Buffer.alloc(64, 0x4a), absolute: true, cdSizeDelta: 64 });
/** The reviewer's fixture B: the same layout with a plausible local header (expected sha256 b6867a50...). */
export const reviewerB = () => buildZip([{ name: 'hello.txt', data: HELLO, lver: 20, time: 0xb5fa, date: 0x5d72, attr: 0o600 }], { prefix: Buffer.alloc(64, 0x4a), absolute: true, cdSizeDelta: 64 });

/** Two different central directories reachable from one EOCD: relative -> entry "a.txt", absolute -> entry "b.txt". */
export function twoCdCandidates(payloadB: Buffer) {
  const prefix = Buffer.alloc(128, 0x4a); // longer than CD B, so the relative lho stays >= 0
  const A = buildZip([{ name: 'a.txt', data: HELLO }]);
  const B = buildZip([{ name: 'b.txt', data: payloadB }]);
  const la = A.buf.subarray(0, A.facts.cdAt); // local A
  const lb = B.buf.subarray(0, B.facts.cdAt); // local B
  const cdA = Buffer.from(A.buf.subarray(A.facts.cdAt, A.facts.eocdAt));
  const cdB = Buffer.from(B.buf.subarray(B.facts.cdAt, B.facts.eocdAt));
  const posLA = prefix.length, posLB = posLA + la.length, posCdB = posLB + lb.length, posCdA = posCdB + cdB.length, posEocd = posCdA + cdA.length;
  cdB.writeUInt32LE(posLB, 42); // absolute interpretation: lho absolute
  const cdOffset = posCdB; // absolute -> CD B
  const delta = posCdA - cdOffset; // relative interpretation: cdStart = eocd - cdSize = posCdA
  cdA.writeUInt32LE(posLA - delta, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cdA.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return { buf: Buffer.concat([prefix, la, lb, cdB, cdA, eocd]), facts: { posLA, posLB, posCdB, posCdA, posEocd, cdOffset, cdSize: cdA.length } };
}

/**
 * R42-IV-F2 decoy: TOP (valid, benign) stores entry "decoy.bin" whose bytes are a structurally-readable
 * but UNVALIDATED ZIP D whose one entry claims a huge compressed size (covering everything after it).
 * Z2 (valid, benign "competing" content) is appended; its EOCD is the file's last, so stock readers read Z2.
 * R4.2 exempted Z2 as "nested" because it lies inside D's CLAIMED entry; R4.3 must not.
 * With `z2LocalsInside`, Z2's local header + data are placed inside TOP's stored entry as well.
 */
export function f2Decoy(z2Payload: Buffer, opts: { z2LocalsInside?: boolean } = {}) {
  // D: one local header (no data of its own) + CD + EOCD; csize claims 0x7fff0000.
  const dName = Buffer.from('claimed.bin');
  const dLocal = Buffer.alloc(30); dLocal.writeUInt32LE(0x04034b50, 0); dLocal.writeUInt16LE(20, 4); dLocal.writeUInt16LE(dName.length, 26);
  const dCd = Buffer.alloc(46); dCd.writeUInt32LE(0x02014b50, 0); dCd.writeUInt16LE(20, 6); dCd.writeUInt32LE(0x7fff0000, 20); dCd.writeUInt16LE(dName.length, 28); dCd.writeUInt32LE(0, 42);
  const dCdFull = Buffer.concat([dCd, dName]);
  const dEocd = Buffer.alloc(22); dEocd.writeUInt32LE(0x06054b50, 0); dEocd.writeUInt16LE(1, 8); dEocd.writeUInt16LE(1, 10); dEocd.writeUInt32LE(dCdFull.length, 12); dEocd.writeUInt32LE(dLocal.length + dName.length, 16);
  const D = Buffer.concat([dLocal, dName, dCdFull, dEocd]);
  if (!opts.z2LocalsInside) {
    const top = buildZip([{ name: 'decoy.bin', data: D, method: 0 }]).buf;
    const z2 = buildZip([{ name: 'competing.txt', data: z2Payload }]).buf; // relative offsets: delta = top.length
    return { buf: Buffer.concat([top, z2]), facts: { topLen: top.length } };
  }
  // Z2's local header + data inside TOP's stored entry (after D); Z2's CD + EOCD appended (relative offsets).
  const z2 = buildZip([{ name: 'competing.txt', data: z2Payload }]);
  const z2Local = z2.buf.subarray(0, z2.facts.cdAt);
  const inner = Buffer.concat([D, z2Local]);
  const top = buildZip([{ name: 'decoy.bin', data: inner, method: 0 }]).buf;
  const topLocalHdr = 30 + 'decoy.bin'.length;
  const z2LocalPos = topLocalHdr + D.length;
  const cd = Buffer.from(z2.buf.subarray(z2.facts.cdAt, z2.facts.eocdAt));
  const eocd = Buffer.from(z2.buf.subarray(z2.facts.eocdAt));
  // relative: cdStart (= top.length) - cdOffset = delta; lho + delta = z2LocalPos
  const cdOffset = top.length - z2LocalPos; const delta = top.length - cdOffset; cd.writeUInt32LE(z2LocalPos - delta, 42); eocd.writeUInt32LE(cdOffset, 16); // delta = z2LocalPos >= 0, lho = 0: Z2 parses strictly on its own
  return { buf: Buffer.concat([top, cd, eocd]), facts: { topLen: top.length, z2LocalPos } };
}

/** gzip member with an FEXTRA field. */
export function gzipWithExtra(data: Buffer, extra: Buffer): Buffer {
  const h = Buffer.from([0x1f, 0x8b, 8, 0x04, 0, 0, 0, 0, 0, 3]);
  const x = Buffer.alloc(2); x.writeUInt16LE(extra.length, 0);
  const tr = Buffer.alloc(8); tr.writeUInt32LE(crc32(data), 0); tr.writeUInt32LE(data.length, 4);
  return Buffer.concat([h, x, extra, zlib.deflateRawSync(data), tr]);
}

function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.fill(0x20, 148, 156); let s = 0; for (const b of h) s += b; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
export function tar(entries: { name: string; data: Buffer }[]): Buffer {
  const out: Buffer[] = [];
  for (const e of entries) out.push(tarHeader(e.name, e.data.length), e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512));
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}

/** Deterministic signature-dense benign binary (no archive): random bytes with ZIP signature bytes sprinkled in. */
export function signatureNoise(len: number, seed = 0x9e3779b9): Buffer {
  let x = seed >>> 0;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  const b = Buffer.alloc(len);
  for (let i = 0; i + 4 <= len; i += 4) b.writeUInt32LE(rnd(), i);
  b[0] = 0x41;
  const sigs = [[0x50, 0x4b, 5, 6], [0x50, 0x4b, 1, 2]];
  for (let k = 0; k < 64; k++) Buffer.from(sigs[k % 2]).copy(b, 1 + (rnd() % (len - 30)));
  return b;
}
