/**
 * Cinematic DNA (CDNA v1): per-film rubric axes (0-100, uint8) distilled offline by an LLM.
 * Similarity is computed on mean-centred vectors (subtract catalogue mean) so cosine is not
 * artificially high for all-positive vectors.
 */
const MAGIC = "CDNA";

export function encodeDnaBinary(rows = []) {
  const count = rows.length;
  const dim = count ? rows[0].axes.length : 0;
  const buf = new ArrayBuffer(16 + count * 4 + count * dim);
  const view = new DataView(buf);
  for (let i = 0; i < 4; i++) view.setUint8(i, MAGIC.charCodeAt(i));
  view.setUint32(4, 1, true);
  view.setUint32(8, count, true);
  view.setUint32(12, dim, true);
  const bytes = new Uint8Array(buf);
  rows.forEach((r, i) => {
    view.setUint32(16 + i * 4, Number(r.tmdbId), true);
    r.axes.forEach((v, d) => {
      bytes[16 + count * 4 + i * dim + d] = Math.max(0, Math.min(255, Math.round(v)));
    });
  });
  return buf;
}

export function parseDnaBinary(buffer) {
  if (!buffer || buffer.byteLength < 16) throw new Error("Invalid CDNA buffer");
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== MAGIC) throw new Error(`Invalid CDNA magic: ${magic}`);
  if (view.getUint32(4, true) !== 1) throw new Error("Unsupported CDNA version");
  const count = view.getUint32(8, true);
  const dim = view.getUint32(12, true);
  if (count <= 0 || dim <= 0 || dim > 64 || buffer.byteLength !== 16 + count * 4 + count * dim) {
    throw new Error("Invalid CDNA size");
  }
  const bytes = new Uint8Array(buffer);
  const idToIndex = new Map();
  const mean = new Float32Array(dim);
  for (let i = 0; i < count; i++) idToIndex.set(view.getUint32(16 + i * 4, true), i);
  const vectors = new Float32Array(count * dim);
  const base = 16 + count * 4;
  for (let i = 0; i < count * dim; i++) {
    vectors[i] = bytes[base + i];
    mean[i % dim] += vectors[i] / count;
  }
  for (let i = 0; i < count * dim; i++) vectors[i] -= mean[i % dim];
  return { count, dim, idToIndex, vectors };
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 1e-12 && nb > 1e-12 ? dot / Math.sqrt(na * nb) : 0;
}

const slice = (idx, i) => idx.vectors.subarray(i * idx.dim, (i + 1) * idx.dim);

/** Average centred vector of the films the user loved; null if none are in the index. */
export function buildUserDnaProfile(idx, lovedTmdbIds = []) {
  const acc = new Float32Array(idx.dim);
  let n = 0;
  for (const id of lovedTmdbIds) {
    const i = idx.idToIndex.get(Number(id));
    if (i === undefined) continue;
    const v = slice(idx, i);
    for (let d = 0; d < idx.dim; d++) acc[d] += v[d];
    n++;
  }
  return n ? acc : null;
}

/** Pearson-style similarity in [-1, 1]; 0 when data is missing. */
export function dnaSim(idx, profile, tmdbId) {
  const i = idx.idToIndex.get(Number(tmdbId));
  if (!profile || i === undefined) return 0;
  return cosine(profile, slice(idx, i));
}
